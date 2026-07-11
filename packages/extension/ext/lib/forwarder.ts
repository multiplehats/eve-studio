export interface ForwarderOptions {
  url: string;
  batchDelayMs?: number;
  flushTimeoutMs?: number;
  backoffMs?: number;
  maxQueue?: number;
  fetchImpl?: typeof fetch;
}

export class Forwarder {
  #queue: unknown[] = [];
  #timer: ReturnType<typeof setTimeout> | undefined;
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
      this.#queue.push(envelope);
      if (this.#queue.length > this.#opts.maxQueue) {
        this.#queue.splice(0, this.#queue.length - this.#opts.maxQueue);
      }
      this.#timer ??= setTimeout(() => {
        this.#timer = undefined;
        void this.#send();
      }, this.#opts.batchDelayMs);
    } catch {
      /* never throw into the turn path */
    }
  }

  /** Awaited only on terminal events. Bounded by flushTimeoutMs. */
  async flushTerminal(): Promise<void> {
    try {
      if (this.#timer) {
        clearTimeout(this.#timer);
        this.#timer = undefined;
      }
      await this.#send({ force: true, timeoutMs: this.#opts.flushTimeoutMs });
    } catch {
      /* bounded, silent */
    }
  }

  async #send(o: { force?: boolean; timeoutMs?: number } = {}): Promise<void> {
    if (this.#queue.length === 0) return;
    if (!o.force && Date.now() < this.#suppressedUntil) return;
    const events = this.#queue.splice(0);
    const timeoutMs = o.timeoutMs ?? this.#opts.flushTimeoutMs;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      // Bound ourselves with a race — never trust fetchImpl to honor the abort
      // signal (and node's fetch can stall past it). The AbortSignal stays as a
      // best-effort connection cleanup.
      await Promise.race([
        this.#opts.fetchImpl(`${this.#opts.url}/ingest`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ events }),
          signal: AbortSignal.timeout(timeoutMs),
        }),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("flush timeout")), timeoutMs);
        }),
      ]);
      this.#suppressedUntil = 0;
    } catch {
      this.#suppressedUntil = Date.now() + this.#opts.backoffMs;
      this.#queue.unshift(...events.slice(-this.#opts.maxQueue));
    } finally {
      clearTimeout(timer);
    }
  }
}
