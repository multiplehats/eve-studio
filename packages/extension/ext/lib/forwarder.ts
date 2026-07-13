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

export class Forwarder {
  #queue: QueueEntry[] = [];
  #activeBatch: QueueEntry[] = [];
  #nextId = 0;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #drainPromise: Promise<void> | undefined;
  #suppressedUntil = 0;
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
    try {
      this.#clearTimer();
      const throughId = this.#nextId - 1;
      const deadline = Date.now() + this.#opts.flushTimeoutMs;

      while (this.#hasPendingThrough(throughId)) {
        if (this.#drainPromise) {
          if (!(await this.#waitUntil(this.#drainPromise, deadline))) return;
          continue;
        }

        if (Date.now() >= deadline) return;
        this.#clearTimer();
        const drain = this.#startDrain({ force: true, deadline, throughId });
        if (!(await this.#waitUntil(drain, deadline))) return;
      }
    } catch {
      /* bounded, silent */
    }
  }

  #schedule(delayMs: number): void {
    if (this.#timer || this.#queue.length === 0) return;
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      void this.#startDrain({ force: false });
    }, Math.max(0, delayMs));
    this.#timer.unref?.();
  }

  #clearTimer(): void {
    if (!this.#timer) return;
    clearTimeout(this.#timer);
    this.#timer = undefined;
  }

  #startDrain(options: DrainOptions): Promise<void> {
    if (this.#drainPromise) return this.#drainPromise;

    const drain = Promise.resolve()
      .then(() => this.#drain(options))
      .catch(() => {
        /* internal work never rejects into hook callbacks */
      })
      .finally(() => {
        if (this.#drainPromise === drain) this.#drainPromise = undefined;
      });
    this.#drainPromise = drain;
    return drain;
  }

  async #drain(options: DrainOptions): Promise<void> {
    while (this.#hasQueuedThrough(options.throughId)) {
      const now = Date.now();
      if (!options.force && now < this.#suppressedUntil) {
        this.#schedule(this.#suppressedUntil - now);
        return;
      }
      if (options.deadline !== undefined && now >= options.deadline) return;

      const batch = this.#takeBatch(options.throughId);
      if (batch.length === 0) return;
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
        this.#schedule(this.#opts.backoffMs);
        return;
      } finally {
        this.#activeBatch = [];
      }
    }
  }

  async #boundedFetch(batch: QueueEntry[], timeoutMs: number): Promise<Response> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.#opts.fetchImpl(`${this.#opts.url}/ingest`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ events: batch.map(({ event }) => event) }),
          signal: AbortSignal.timeout(timeoutMs),
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("flush timeout")), timeoutMs);
          timer.unref?.();
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
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

  async #waitUntil(promise: Promise<void>, deadline: number): Promise<boolean> {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return false;

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise.then(() => true),
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(false), remaining);
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
