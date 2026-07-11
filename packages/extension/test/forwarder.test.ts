import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Forwarder } from "../ext/lib/forwarder.js";

const flushedBodies = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string));

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
    // The mock deliberately ignores the AbortSignal — the implementation must
    // bound itself (Promise.race), not trust fetch to honor the signal.
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
    // Suppression cleared on success: prove it via the TIMER path — flushTerminal
    // always forces, so a second flushTerminal could not distinguish suppressed
    // from clear. A batch-timer send is skipped while suppressed, so reaching
    // fetch here is the real assertion.
    f.push({ a: 3 });
    await vi.advanceTimersByTimeAsync(25);
    expect(calls).toHaveLength(2);
  });
});
