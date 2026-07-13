export interface ForwarderOptions {
  url: string;
  batchDelayMs?: number;
  flushTimeoutMs?: number;
  backoffMs?: number;
  maxQueue?: number;
  fetchImpl?: typeof fetch;
}

interface QueueEntry {
  id: number;
  event: unknown;
}

interface DrainOptions {
  force: boolean;
  deadline?: number;
  throughId?: number;
}

type DrainResult = "success" | "failed" | "deferred";

export class Forwarder {
  #queue: QueueEntry[] = [];
  #activeBatch: QueueEntry[] = [];
  #nextId = 0;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #drainPromise: Promise<DrainResult> | undefined;
  #suppressedUntil = 0;
  #terminalWaiters = 0;
  readonly #opts: Required<ForwarderOptions>;

  constructor(opts: ForwarderOptions) {
    this.#opts = {
      batchDelayMs: 25,
      flushTimeoutMs: 500,
      backoffMs: 5_000,
      maxQueue: 5_000,
      fetchImpl: fetch,
      ...opts,
    };
  }

  get queueLength(): number {
    return this.#queue.length;
  }

  /** Synchronous, never throws. Steady-state entry point. */
  push(envelope: unknown): void {
    try {
      this.#queue.push({ id: this.#nextId++, event: envelope });
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
          if ((await this.#waitUntil(this.#drainPromise, deadline)) === undefined) return;
          continue;
        }

        if (Date.now() >= deadline || forcedAttempted) return;
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
      body: JSON.stringify({ events: batch.map(({ event }) => event) }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  }

  #takeBatch(throughId: number | undefined): QueueEntry[] {
    if (throughId === undefined) return this.#queue.splice(0);
    let count = 0;
    while (count < this.#queue.length && this.#queue[count].id <= throughId) count += 1;
    return this.#queue.splice(0, count);
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
    if (this.#queue.length <= this.#opts.maxQueue) return;
    this.#queue.splice(0, this.#queue.length - this.#opts.maxQueue);
  }
}
