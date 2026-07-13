import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Forwarder } from "../ext/lib/forwarder.js";

const flushedBodies = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("Forwarder", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("push is synchronous and batches multiple events into one POST", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const f = new Forwarder({ url: "http://127.0.0.1:43118", batchDelayMs: 10, fetchImpl: fetchMock });
    f.push({ seq: 0 });
    f.push({ seq: 1 });
    expect(fetchMock).not.toHaveBeenCalled(); // nothing awaited inline
    await vi.advanceTimersByTimeAsync(25);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(flushedBodies(fetchMock)[0].events).toHaveLength(2);
  });

  it("flushTerminal resolves within the timeout even when fetch hangs and ignores abort", async () => {
    // The terminal waiter owns its deadline even when the in-flight request
    // deliberately ignores AbortSignal.
    const fetchMock = vi.fn().mockImplementation(() => new Promise(() => {}));
    const f = new Forwarder({ url: "http://127.0.0.1:43118", flushTimeoutMs: 100, fetchImpl: fetchMock });
    f.push({ seq: 0 });
    const pending = f.flushTerminal();
    await vi.advanceTimersByTimeAsync(150);
    await expect(pending).resolves.toBeUndefined();
  });

  it("swallows network errors and backs off instead of retry-storming", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const f = new Forwarder({ url: "http://127.0.0.1:43118", batchDelayMs: 5, backoffMs: 10_000, fetchImpl: fetchMock });
    f.push({ seq: 0 });
    await vi.advanceTimersByTimeAsync(10); // first send fires and fails -> backoff starts
    f.push({ seq: 1 });
    await vi.advanceTimersByTimeAsync(10); // within backoff window: send suppressed
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("makes only one forced attempt when a terminal flush fails immediately", async () => {
    vi.useRealTimers();
    const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const f = new Forwarder({
      url: "http://127.0.0.1:43118",
      flushTimeoutMs: 25,
      backoffMs: 1_000,
      fetchImpl: fetchMock,
    });

    f.push({ seq: 0 });
    await f.flushTerminal();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("caps the queue instead of growing unboundedly while collector is down", () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const f = new Forwarder({ url: "http://127.0.0.1:43118", maxQueue: 100, fetchImpl: fetchMock });
    for (let i = 0; i < 500; i++) f.push({ seq: i });
    expect(f.queueLength).toBeLessThanOrEqual(100);
  });

  it("flushTerminal success path: drains queue, posts one batch, clears suppression", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(init.body as string) });
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;
    const f = new Forwarder({ url: "http://127.0.0.1:1", fetchImpl });
    f.push({ a: 1 });
    f.push({ a: 2 });
    await f.flushTerminal();
    expect(f.queueLength).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("http://127.0.0.1:1/ingest");
    expect(calls[0].body).toEqual({ events: [{ a: 1 }, { a: 2 }] });
    // Suppression cleared on success: prove it via the TIMER path. flushTerminal
    // always forces, so a second flushTerminal could not distinguish suppressed
    // from clear. A batch-timer send is skipped while suppressed, so reaching
    // fetch here is the real assertion.
    f.push({ a: 3 });
    await vi.advanceTimersByTimeAsync(25);
    expect(calls).toHaveLength(2);
  });

  it("keeps at most one collector request in flight", async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    let active = 0;
    let maxActive = 0;
    const fetchMock = vi.fn().mockImplementation(() => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      const response = fetchMock.mock.calls.length === 1 ? first.promise : second.promise;
      return response.finally(() => {
        active -= 1;
      });
    });
    const f = new Forwarder({ url: "http://127.0.0.1:43118", batchDelayMs: 5, fetchImpl: fetchMock });

    f.push({ seq: 0 });
    await vi.advanceTimersByTimeAsync(5);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    f.push({ seq: 1 });
    await vi.advanceTimersByTimeAsync(5);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    first.resolve(new Response(null, { status: 204 }));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(maxActive).toBe(1);

    second.resolve(new Response(null, { status: 204 }));
    await vi.advanceTimersByTimeAsync(0);
    expect(f.queueLength).toBe(0);
  });

  it("flushTerminal joins an active request before draining the queued terminal batch", async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const f = new Forwarder({ url: "http://127.0.0.1:43118", batchDelayMs: 5, fetchImpl: fetchMock });

    f.push({ seq: 0 });
    await vi.advanceTimersByTimeAsync(5);
    f.push({ seq: 1 });
    const pending = f.flushTerminal();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    first.resolve(new Response(null, { status: 204 }));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(flushedBodies(fetchMock)).toEqual([{ events: [{ seq: 0 }] }, { events: [{ seq: 1 }] }]);

    second.resolve(new Response(null, { status: 204 }));
    await vi.advanceTimersByTimeAsync(0);
    await expect(pending).resolves.toBeUndefined();
    expect(f.queueLength).toBe(0);
  });

  it("reschedules an event pushed while a forced drain is active", async () => {
    const first = deferred<Response>();
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const f = new Forwarder({
      url: "http://127.0.0.1:43118",
      batchDelayMs: 5,
      fetchImpl: fetchMock,
    });

    f.push({ seq: 0 });
    const terminal = f.flushTerminal();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    f.push({ seq: 1 });
    await vi.advanceTimersByTimeAsync(5);
    first.resolve(new Response(null, { status: 204 }));
    await terminal;
    await vi.advanceTimersByTimeAsync(5);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(flushedBodies(fetchMock)[1]).toEqual({ events: [{ seq: 1 }] });
  });

  it("treats a non-2xx collector response as a failed delivery and requeues the exact batch", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const f = new Forwarder({ url: "http://127.0.0.1:43118", batchDelayMs: 5, backoffMs: 10_000, fetchImpl: fetchMock });

    f.push({ seq: 0 });
    f.push({ seq: 1 });
    await vi.advanceTimersByTimeAsync(5);
    expect(f.queueLength).toBe(2);

    await f.flushTerminal();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(flushedBodies(fetchMock)).toEqual([
      { events: [{ seq: 0 }, { seq: 1 }] },
      { events: [{ seq: 0 }, { seq: 1 }] },
    ]);
    expect(f.queueLength).toBe(0);
  });

  it("requeues before newer events and applies the cap once while preserving newest order", async () => {
    const first = deferred<Response>();
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const f = new Forwarder({
      url: "http://127.0.0.1:43118",
      batchDelayMs: 5,
      backoffMs: 10_000,
      maxQueue: 3,
      fetchImpl: fetchMock,
    });

    f.push({ seq: 0 });
    f.push({ seq: 1 });
    await vi.advanceTimersByTimeAsync(5);
    f.push({ seq: 2 });
    f.push({ seq: 3 });
    f.push({ seq: 4 });
    first.reject(new Error("ECONNREFUSED"));
    await vi.advanceTimersByTimeAsync(0);

    expect(f.queueLength).toBe(3);
    await f.flushTerminal();
    expect(flushedBodies(fetchMock)[1]).toEqual({ events: [{ seq: 2 }, { seq: 3 }, { seq: 4 }] });
  });

  it("uses one terminal deadline without overlapping a hanging active request", async () => {
    const fetchMock = vi.fn().mockImplementation(() => new Promise(() => {}));
    const f = new Forwarder({
      url: "http://127.0.0.1:43118",
      batchDelayMs: 5,
      flushTimeoutMs: 100,
      fetchImpl: fetchMock,
    });

    f.push({ seq: 0 });
    await vi.advanceTimersByTimeAsync(40);
    f.push({ seq: 1 });
    const pending = f.flushTerminal();

    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(99);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("gives a terminal waiter the remaining deadline after an active batch", async () => {
    vi.useRealTimers();
    const first = deferred<Response>();
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce((_url: string | URL | Request, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (!signal) return;
          if (signal.aborted) {
            reject(signal.reason);
            return;
          }
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      });
    const f = new Forwarder({
      url: "http://127.0.0.1:43118",
      batchDelayMs: 1,
      flushTimeoutMs: 100,
      fetchImpl: fetchMock,
    });

    f.push({ seq: 0 });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    f.push({ seq: 1 });
    const terminal = f.flushTerminal();
    setTimeout(() => first.resolve(new Response(null, { status: 204 })), 20);
    await terminal;
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(f.queueLength).toBe(1);
  });
});
