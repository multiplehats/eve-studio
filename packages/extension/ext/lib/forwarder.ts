import { Buffer } from "node:buffer";

export interface ForwarderOptions {
  url: string;
  batchDelayMs?: number;
  flushTimeoutMs?: number;
  backoffMs?: number;
  maxQueue?: number;
  maxQueueBytes?: number;
  maxBatchBytes?: number;
  maxBatchEvents?: number;
  fetchImpl?: typeof fetch;
}

interface QueueEntry {
  id: number;
  serialized: string;
  byteLength: number;
}

interface DrainOptions {
  force: boolean;
  deadline?: number;
  throughId?: number;
}

type DrainResult = "success" | "failed" | "deferred";

const BATCH_PREFIX = '{"events":[';
const BATCH_SUFFIX = "]}";
const BATCH_OVERHEAD_BYTES = Buffer.byteLength(BATCH_PREFIX) + Buffer.byteLength(BATCH_SUFFIX);
const MAX_COLLECTOR_BODY_BYTES = 32 * 1024 * 1024;
const MAX_QUEUE_BYTES = 32 * 1024 * 1024;
const MAX_QUEUE_EVENTS = 5_000;
const MAX_BATCH_EVENTS = 250;

export class Forwarder {
  #queue: QueueEntry[] = [];
  #queueBytes = 0;
  #activeBatch: QueueEntry[] = [];
  #nextId = 0;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #drainPromise: Promise<DrainResult> | undefined;
  #suppressedUntil = 0;
  #terminalWaiters = 0;
  readonly #opts: Required<ForwarderOptions>;

  constructor(opts: ForwarderOptions) {
    const maxQueue = Number.isSafeInteger(opts.maxQueue) && opts.maxQueue! > 0
      ? Math.min(opts.maxQueue!, MAX_QUEUE_EVENTS)
      : MAX_QUEUE_EVENTS;
    const maxQueueBytes = Number.isSafeInteger(opts.maxQueueBytes) && opts.maxQueueBytes! > 0
      ? Math.min(opts.maxQueueBytes!, MAX_QUEUE_BYTES)
      : MAX_QUEUE_BYTES;
    const maxBatchBytes = Number.isSafeInteger(opts.maxBatchBytes) && opts.maxBatchBytes! > BATCH_OVERHEAD_BYTES
      ? Math.min(opts.maxBatchBytes!, MAX_COLLECTOR_BODY_BYTES)
      : MAX_COLLECTOR_BODY_BYTES;
    const maxBatchEvents = Number.isSafeInteger(opts.maxBatchEvents) && opts.maxBatchEvents! > 0
      ? Math.min(opts.maxBatchEvents!, MAX_BATCH_EVENTS)
      : MAX_BATCH_EVENTS;
    this.#opts = {
      batchDelayMs: 25,
      flushTimeoutMs: 500,
      backoffMs: 5_000,
      fetchImpl: fetch,
      ...opts,
      maxQueue,
      maxQueueBytes,
      maxBatchBytes,
      maxBatchEvents,
    };
  }

  get queueLength(): number {
    return this.#queue.length;
  }

  get queueByteLength(): number {
    return this.#queueBytes;
  }

  /** Synchronous, never throws. Steady-state entry point. */
  push(envelope: unknown): void {
    try {
      const serialized = JSON.stringify(envelope);
      if (serialized === undefined) return;
      const byteLength = Buffer.byteLength(serialized, "utf8");
      if (BATCH_OVERHEAD_BYTES + byteLength > this.#opts.maxBatchBytes) return;
      if (byteLength > this.#opts.maxQueueBytes) return;
      this.#queue.push({ id: this.#nextId++, serialized, byteLength });
      this.#queueBytes += byteLength;
      this.#trimQueue();
      this.#schedule(this.#opts.batchDelayMs);
    } catch {
      /* never throw into the turn path */
    }
  }

  /** Awaited only on terminal events. Bounded by one flushTimeoutMs deadline. */
  async flushTerminal(): Promise<void> {
    this.#terminalWaiters += 1;
    try {
      this.#clearTimer();
      const throughId = this.#nextId - 1;
      const deadline = Date.now() + this.#opts.flushTimeoutMs;
      let forcedAttempted = false;

      while (this.#hasPendingThrough(throughId)) {
        if (this.#drainPromise) {
          const result = await this.#waitUntil(this.#drainPromise, deadline);
          if (result === undefined || result === "failed") return;
          continue;
        }

        if (Date.now() >= deadline || Date.now() < this.#suppressedUntil || forcedAttempted) return;
        forcedAttempted = true;
        this.#clearTimer();
        const drain = this.#startDrain({ force: true, deadline, throughId });
        const result = await this.#waitUntil(drain, deadline);
        if (result === undefined || result === "failed") return;
      }
    } catch {
      /* bounded, silent */
    } finally {
      this.#terminalWaiters = Math.max(0, this.#terminalWaiters - 1);
      this.#schedule(this.#opts.batchDelayMs);
    }
  }

  #schedule(delayMs: number): void {
    if (this.#timer || this.#drainPromise || this.#terminalWaiters > 0 || this.#queue.length === 0) return;
    const backoffRemaining = Math.max(0, this.#suppressedUntil - Date.now());
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      void this.#startDrain({ force: false });
    }, Math.max(0, delayMs, backoffRemaining));
    this.#timer.unref?.();
  }

  #clearTimer(): void {
    if (!this.#timer) return;
    clearTimeout(this.#timer);
    this.#timer = undefined;
  }

  #startDrain(options: DrainOptions): Promise<DrainResult> {
    if (this.#drainPromise) return this.#drainPromise;

    const drain = Promise.resolve()
      .then(() => this.#drain(options))
      .catch((): DrainResult => {
        /* internal work never rejects into hook callbacks */
        return "failed";
      })
      .finally(() => {
        if (this.#drainPromise === drain) this.#drainPromise = undefined;
        this.#schedule(this.#opts.batchDelayMs);
      });
    this.#drainPromise = drain;
    return drain;
  }

  async #drain(options: DrainOptions): Promise<DrainResult> {
    while (this.#hasQueuedThrough(options.throughId)) {
      const now = Date.now();
      if (!options.force && now < this.#suppressedUntil) {
        return "deferred";
      }
      if (options.deadline !== undefined && now >= options.deadline) return "deferred";

      const batch = this.#takeBatch(options.throughId);
      if (batch.length === 0) return "success";
      this.#activeBatch = batch;

      try {
        const timeoutMs = Math.max(
          1,
          Math.min(
            this.#opts.flushTimeoutMs,
            options.deadline === undefined ? this.#opts.flushTimeoutMs : options.deadline - Date.now(),
          ),
        );
        const response = await this.#boundedFetch(batch, timeoutMs);
        if (!response.ok) throw new Error(`collector responded ${response.status}`);
        this.#suppressedUntil = 0;
      } catch {
        this.#queue.unshift(...batch);
        this.#queueBytes += batch.reduce((total, entry) => total + entry.byteLength, 0);
        this.#trimQueue();
        this.#suppressedUntil = Date.now() + this.#opts.backoffMs;
        return "failed";
      } finally {
        this.#activeBatch = [];
      }

      if (!options.force && this.#terminalWaiters > 0) return "success";
    }
    return "success";
  }

  async #boundedFetch(batch: QueueEntry[], timeoutMs: number): Promise<Response> {
    return await this.#opts.fetchImpl(`${this.#opts.url}/ingest`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: `${BATCH_PREFIX}${batch.map(({ serialized }) => serialized).join(",")}${BATCH_SUFFIX}`,
      signal: AbortSignal.timeout(timeoutMs),
    });
  }

  #takeBatch(throughId: number | undefined): QueueEntry[] {
    let count = 0;
    let byteLength = BATCH_OVERHEAD_BYTES;
    let queuedByteLength = 0;
    while (count < this.#queue.length && count < this.#opts.maxBatchEvents) {
      const entry = this.#queue[count];
      if (throughId !== undefined && entry.id > throughId) break;
      const nextByteLength = byteLength + entry.byteLength + (count === 0 ? 0 : 1);
      if (nextByteLength > this.#opts.maxBatchBytes) break;
      byteLength = nextByteLength;
      queuedByteLength += entry.byteLength;
      count += 1;
    }
    const batch = this.#queue.splice(0, count);
    this.#queueBytes -= queuedByteLength;
    return batch;
  }

  #hasQueuedThrough(throughId: number | undefined): boolean {
    if (throughId === undefined) return this.#queue.length > 0;
    return this.#queue.some(({ id }) => id <= throughId);
  }

  #hasPendingThrough(throughId: number): boolean {
    if (throughId < 0) return false;
    return (
      this.#activeBatch.some(({ id }) => id <= throughId) ||
      this.#queue.some(({ id }) => id <= throughId)
    );
  }

  async #waitUntil(promise: Promise<DrainResult>, deadline: number): Promise<DrainResult | undefined> {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return undefined;

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<undefined>((resolve) => {
          timer = setTimeout(() => resolve(undefined), remaining);
          timer.unref?.();
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  #trimQueue(): void {
    if (this.#queue.length <= this.#opts.maxQueue && this.#queueBytes <= this.#opts.maxQueueBytes) return;
    let removeCount = Math.max(0, this.#queue.length - this.#opts.maxQueue);
    let remainingBytes = this.#queueBytes;
    for (let index = 0; index < removeCount; index += 1) {
      remainingBytes -= this.#queue[index].byteLength;
    }
    while (removeCount < this.#queue.length && remainingBytes > this.#opts.maxQueueBytes) {
      remainingBytes -= this.#queue[removeCount].byteLength;
      removeCount += 1;
    }
    this.#queue.splice(0, removeCount);
    this.#queueBytes = Math.max(0, remainingBytes);
  }
}
