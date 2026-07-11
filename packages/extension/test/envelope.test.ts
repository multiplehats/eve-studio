import { describe, expect, it } from "vitest";
import { buildEnvelope, isInert, type EnvelopeState } from "../ext/lib/envelope.js";

const ctx = { agent: { name: "demo-agent" }, session: { id: "wrun_abc" }, channel: { kind: "eve" } };

function freshState(overrides: Partial<EnvelopeState> = {}): EnvelopeState {
  return {
    counters: new Map(),
    hookEpoch: "epoch-1",
    project: { name: "p", root: "r" },
    processInfo: { instanceId: "i", kind: "unknown", pid: 1 },
    group: undefined,
    ...overrides,
  };
}

describe("buildEnvelope", () => {
  it("stamps per-session monotonic seq and identity fields", () => {
    const state = { counters: new Map(), hookEpoch: "epoch-1", project: { name: "demo", root: "hash" }, processInfo: { instanceId: "i-1", kind: "dev", pid: 1 } };
    const a = buildEnvelope({ type: "session.started", data: {} }, ctx, state);
    const b = buildEnvelope({ type: "turn.started", data: {} }, ctx, state);
    expect(a.seq).toBe(0);
    expect(b.seq).toBe(1);
    expect(a.sessionId).toBe("wrun_abc");
    expect(a.agent).toBe("demo-agent");
    expect(a.hookEpoch).toBe("epoch-1");
    expect(a.process.instanceId).toBe("i-1");
  });

  it("strips messageSoFar from message.appended", () => {
    const state = { counters: new Map(), hookEpoch: "e", project: { name: "p", root: "r" }, processInfo: { instanceId: "i", kind: "dev", pid: 1 } };
    const env = buildEnvelope(
      { type: "message.appended", data: { messageDelta: "hi", messageSoFar: "a".repeat(10_000) } },
      ctx,
      state,
    );
    expect((env.event as { data: Record<string, unknown> }).data.messageSoFar).toBeUndefined();
    expect((env.event as { data: Record<string, unknown> }).data.messageDelta).toBe("hi");
  });

  it("strips messageSoFar from a subagent-wrapped message.appended without mutating the input", () => {
    const state = { counters: new Map(), hookEpoch: "e", project: { name: "p", root: "r" }, processInfo: { instanceId: "i", kind: "dev", pid: 1 } };
    const input = {
      type: "subagent.event",
      data: {
        event: { type: "message.appended", data: { messageDelta: "hi", messageSoFar: "a".repeat(10_000) } },
      },
    };
    const env = buildEnvelope(input, ctx, state);

    const nestedData = (
      (env.event as { data: { event: { data: Record<string, unknown> } } }).data.event.data
    );
    expect(nestedData.messageSoFar).toBeUndefined();
    expect(nestedData.messageDelta).toBe("hi");

    // original input object must remain untouched at every nesting level
    const inputData = input.data.event.data as Record<string, unknown>;
    expect(inputData.messageSoFar).toBe("a".repeat(10_000));
  });

  it("strips messageSoFar from doubly-nested subagent.event wrapping", () => {
    const state = { counters: new Map(), hookEpoch: "e", project: { name: "p", root: "r" }, processInfo: { instanceId: "i", kind: "dev", pid: 1 } };
    const input = {
      type: "subagent.event",
      data: {
        event: {
          type: "subagent.event",
          data: {
            event: { type: "message.appended", data: { messageDelta: "hi", messageSoFar: "b".repeat(5_000) } },
          },
        },
      },
    };
    const env = buildEnvelope(input, ctx, state);

    const innerData = (
      (env.event as { data: { event: { data: { event: { data: Record<string, unknown> } } } } })
        .data.event.data.event.data
    );
    expect(innerData.messageSoFar).toBeUndefined();
    expect(innerData.messageDelta).toBe("hi");

    // original input object must remain untouched at every nesting level
    const innermostInputData = input.data.event.data.event.data as Record<string, unknown>;
    expect(innermostInputData.messageSoFar).toBe("b".repeat(5_000));
  });
});

describe("isInert", () => {
  it("inert in production unless explicitly enabled", () => {
    expect(isInert({ NODE_ENV: "production" })).toBe(true);
    expect(isInert({ VERCEL_ENV: "production" })).toBe(true);
    expect(isInert({ NODE_ENV: "production", EVE_STUDIO_ENABLED: "1" })).toBe(false);
    expect(isInert({})).toBe(false);
  });
});

describe("envelope v1", () => {
  it("stamps v: 1 on every envelope", () => {
    const env = buildEnvelope({ type: "session.started" }, { session: { id: "s1" } }, freshState());
    expect(env.v).toBe(1);
  });

  it("includes group only when set in state", () => {
    const without = buildEnvelope({ type: "x" }, { session: { id: "s1" } }, freshState());
    expect("group" in without).toBe(false);
    const withGroup = buildEnvelope({ type: "x" }, { session: { id: "s1" } }, freshState({ group: "round-3" }));
    expect(withGroup.group).toBe("round-3");
  });
});

describe("counters LRU", () => {
  it("evicts the least-recently-active session past the cap, never an active one", () => {
    const state = freshState();
    // Fill to the cap with one event each; session "s0" is oldest.
    for (let i = 0; i < 1000; i++) {
      buildEnvelope({ type: "x" }, { session: { id: `s${i}` } }, state);
    }
    // Touch s0 again so it becomes most-recently-active (seq must continue at 1).
    const touched = buildEnvelope({ type: "x" }, { session: { id: "s0" } }, state);
    expect(touched.seq).toBe(1);
    // A new 1001st session evicts the LRU entry — which is now s1, not s0.
    buildEnvelope({ type: "x" }, { session: { id: "s-new" } }, state);
    expect(state.counters.size).toBe(1000);
    expect(state.counters.has("s1")).toBe(false);
    expect(state.counters.has("s0")).toBe(true);
    // s0 keeps counting monotonically.
    const again = buildEnvelope({ type: "x" }, { session: { id: "s0" } }, state);
    expect(again.seq).toBe(2);
  });
});
