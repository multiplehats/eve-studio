import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createRegistry } from "../src/registry.js";
import type { IngestEnvelope } from "../src/types.js";

function env(sessionId: string, seq: number, type: string, extra: Partial<IngestEnvelope> = {}): IngestEnvelope {
  return {
    v: 1,
    project: { name: "p", root: "r" },
    process: { instanceId: "proc-1", kind: "unknown", pid: 1 },
    agent: "a",
    sessionId,
    seq,
    hookEpoch: "epoch-1",
    event: { type },
    ...extra,
  };
}

const FIXTURE: IngestEnvelope[] = readFileSync(new URL("./fixtures/mock-eval-envelopes.ndjson", import.meta.url), "utf8")
  .trim().split("\n").map((l) => JSON.parse(l));

describe("ordering and dedup", () => {
  it("orders shuffled arrivals by position and drops duplicates", () => {
    const r = createRegistry();
    const shuffled = [env("s", 2, "b"), env("s", 0, "session.started"), env("s", 1, "a"), env("s", 1, "a")];
    for (const e of shuffled) r.ingest(e);
    const rec = r.getSession("s")!;
    expect(rec.events.map((e) => e.position)).toEqual([0, 1, 2]);
    expect(r.stats().duplicatesDropped).toBe(1);
  });

  it("epoch reset: marks session degraded, appends after max, never overwrites trusted positions", () => {
    const r = createRegistry();
    r.ingest(env("s", 0, "session.started"));
    r.ingest(env("s", 1, "message.received"));
    // Hook process restarted: same session, new epoch, seq restarts at 0.
    r.ingest(env("s", 0, "message.completed", { hookEpoch: "epoch-2" }));
    const rec = r.getSession("s")!;
    expect(rec.summary.degraded).toBe("epoch-reset");
    expect(rec.events.map((e) => [e.position, e.event.type])).toEqual([
      [0, "session.started"], [1, "message.received"], [2, "message.completed"],
    ]);
  });
});

describe("tolerance", () => {
  it("skips malformed input without throwing", () => {
    const r = createRegistry();
    for (const bad of [null, 42, "x", {}, { sessionId: "s" }, { sessionId: "s", seq: "NaN", hookEpoch: "e", event: { type: "t" } }, { sessionId: "s", seq: 0, hookEpoch: "e", event: {} }]) {
      expect(() => r.ingest(bad)).not.toThrow();
    }
    expect(r.stats().malformedSkipped).toBe(7);
    expect(r.getSessions()).toHaveLength(0);
  });

  it("stores unknown event types raw", () => {
    const r = createRegistry();
    r.ingest(env("s", 0, "totally.unknown.v99"));
    expect(r.getSession("s")!.events[0].event.type).toBe("totally.unknown.v99");
  });
});

describe("status derivation", () => {
  it("walks working -> waiting -> working -> completed by highest position", () => {
    const r = createRegistry();
    r.ingest(env("s", 0, "session.started"));
    expect(r.getSession("s")!.summary.status).toBe("working");
    r.ingest(env("s", 1, "session.waiting"));
    expect(r.getSession("s")!.summary.status).toBe("waiting");
    r.ingest(env("s", 2, "message.received"));
    expect(r.getSession("s")!.summary.status).toBe("working");
    r.ingest(env("s", 3, "session.completed"));
    expect(r.getSession("s")!.summary.status).toBe("completed");
  });

  it("session.failed wins; a LOWER-position straggler cannot regress status", () => {
    const r = createRegistry();
    r.ingest(env("s", 5, "session.failed"));
    r.ingest(env("s", 2, "message.appended"));
    expect(r.getSession("s")!.summary.status).toBe("failed");
  });
});

describe("grouping and usage", () => {
  it("group falls back to process.instanceId, and EVE_STUDIO_GROUP-forwarded group wins", () => {
    const r = createRegistry();
    r.ingest(env("s1", 0, "session.started"));
    r.ingest(env("s2", 0, "session.started", { group: "round-7" }));
    expect(r.getSession("s1")!.summary.group).toBe("proc-1");
    expect(r.getSession("s2")!.summary.group).toBe("round-7");
  });

  it("upgrades unknown identity when live envelopes arrive after disk discovery (the --scan-disk-then-watch flow)", () => {
    const r = createRegistry();
    r.ingestDisk("s", [{ position: 0, event: { type: "session.started" } }]);
    expect(r.getSession("s")!.summary.agent).toBe("unknown");
    r.ingest(env("s", 1, "message.received", { group: "round-1" }));
    const sum = r.getSession("s")!.summary;
    expect(sum.agent).toBe("a");
    expect(sum.project).toEqual({ name: "p", root: "r" });
    expect(sum.processInstanceId).toBe("proc-1");
    expect(sum.group).toBe("round-1");
  });

  it("captures eveVersion from session.started", () => {
    const r = createRegistry();
    // Pinned field path (DEVIATIONS §Plan B Task 2): event.data.runtime.eveVersion, nested under runtime.
    r.ingest(env("s", 0, "session.started", { event: { type: "session.started", data: { runtime: { eveVersion: "0.22.4" } } } }));
    expect(r.getSession("s")!.summary.eveVersion).toBe("0.22.4");
  });

  it("rolls up usage from the real fixture's step.completed events", () => {
    const r = createRegistry();
    for (const e of FIXTURE) r.ingest(e);
    const sessions = r.getSessions();
    expect(sessions.length).toBe(1);
    const session = sessions[0]!;
    // Pinned from the fixture's two step.completed events (seq 6 and seq 14):
    // seq 6:  usage = { inputTokens: 88, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 }
    // seq 14: usage = { inputTokens: 95, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 }
    // Neither carries costUsd, so it stays at the accumulator's initial 0.
    expect(session.usage).toEqual({ inputTokens: 183, outputTokens: 10, costUsd: 0, steps: 2 });
    // Ground-truth check against the real fixture's seq-0 session.started
    // (data.runtime.eveVersion), independent of the hand-built env() test above.
    expect(session.eveVersion).toBe("0.22.4");
  });
});

describe("byte-cap eviction", () => {
  it("evicts a sole oversized raw event after reducing it", () => {
    const r = createRegistry({ maxSessionBytes: 10 });
    r.ingest(env("s", 0, "message.appended", {
      event: {
        type: "message.appended",
        data: {
          messageDelta: "projected text survives raw eviction",
          turnId: "turn-1",
          stepIndex: 0,
          sequence: 0,
        },
      },
    }));

    const rec = r.getSession("s")!;
    expect(rec.events).toEqual([]);
    expect(rec.summary.eventCount).toBe(0);
    expect(rec.summary.evictedBelow).toBe(1);
    expect(rec.reducedUpTo).toBe(1);
    expect(JSON.stringify(rec.reducedState)).toContain("projected text survives raw eviction");
  });

  it("evicts oldest raw events past the cap and records evictedBelow", () => {
    const r = createRegistry({ maxSessionBytes: 2_000 });
    const big = "x".repeat(500);
    for (let i = 0; i < 10; i++) r.ingest(env("s", i, "message.appended", { event: { type: "message.appended", data: { messageDelta: big } } }));
    const rec = r.getSession("s")!;
    expect(rec.summary.evictedBelow).toBeGreaterThan(0);
    expect(rec.events[0].position).toBe(rec.summary.evictedBelow);
    expect(rec.summary.eventCount).toBe(rec.events.length);
    expect(rec.summary.maxPosition).toBe(9);
  });

  it("accounts for UTF-8 bytes instead of JavaScript string length", () => {
    const first = { type: "custom", data: { value: "😀" } };
    const second = { type: "custom", data: { value: "😀" } };
    const codeUnitBytes = JSON.stringify(first).length + JSON.stringify(second).length;
    const utf8Bytes = Buffer.byteLength(JSON.stringify(first), "utf8") + Buffer.byteLength(JSON.stringify(second), "utf8");
    expect(utf8Bytes).toBeGreaterThan(codeUnitBytes);
    const r = createRegistry({ maxSessionBytes: codeUnitBytes });

    r.ingest(env("s", 0, "custom", { event: first }));
    r.ingest(env("s", 1, "custom", { event: second }));

    expect(r.getSession("s")!.events.map((event) => event.position)).toEqual([1]);
  });
});

describe("subscribe", () => {
  it("notifies event + session updates and honors unsubscribe", () => {
    const r = createRegistry();
    const seen: string[] = [];
    const off = r.subscribe((u) => seen.push(u.kind));
    r.ingest(env("s", 0, "session.started"));
    expect(seen).toContain("event");
    expect(seen).toContain("session");
    off();
    r.ingest(env("s", 1, "x"));
    expect(seen.length).toBe(2);
  });

  it("omits raw event bodies from event notifications", () => {
    const r = createRegistry();
    const updates: unknown[] = [];
    r.subscribe((update) => updates.push(update));

    r.ingest(env("s", 0, "secret.event", { event: { type: "secret.event", data: { secret: "do-not-stream" } } }));

    expect(updates[0]).toEqual({ kind: "event", sessionId: "s", position: 0 });
    expect(updates[0]).not.toHaveProperty("event");
  });
});

describe("session-count cap", () => {
  it("evicts the oldest terminal session first and emits session-removed", () => {
    let clock = 0;
    const r = createRegistry({ maxSessions: 2, now: () => ++clock });
    const updates: unknown[] = [];
    r.subscribe((update) => updates.push(update));
    r.ingest(env("terminal", 0, "session.completed"));
    r.ingest(env("working", 0, "session.started"));

    r.ingest(env("new", 0, "session.started"));

    expect(r.getSessions().map((session) => session.sessionId).sort()).toEqual(["new", "working"]);
    expect(updates).toContainEqual({ kind: "session-removed", sessionId: "terminal" });
    expect(r.stats().sessions).toBe(2);
  });

  it("evicts the oldest session when none are terminal", () => {
    let clock = 0;
    const r = createRegistry({ maxSessions: 2, now: () => ++clock });
    r.ingest(env("oldest", 0, "session.started"));
    r.ingest(env("newer", 0, "session.started"));

    r.ingest(env("newest", 0, "session.started"));

    expect(r.getSessions().map((session) => session.sessionId).sort()).toEqual(["newer", "newest"]);
  });
});

describe("disk merge", () => {
  it("ingestDisk is idempotent against live events on sessionId + position", () => {
    const r = createRegistry();
    r.ingest(env("s", 0, "session.started"));
    r.ingest(env("s", 1, "message.received"));
    r.ingestDisk("s", [
      { position: 0, event: { type: "session.started" } },
      { position: 1, event: { type: "message.received" } },
      { position: 2, event: { type: "session.waiting" } },
    ]);
    const rec = r.getSession("s")!;
    expect(rec.events.map((e) => e.position)).toEqual([0, 1, 2]);
    expect(rec.events[0].source).toBe("live");              // live version kept, disk dup dropped
    expect(rec.events[2].source).toBe("disk");
    expect(rec.summary.status).toBe("waiting");
  });

  it("DOCUMENTED LIMITATION: after an epoch reset, positions are synthetic, so disk events colliding with them are dropped with no repair", () => {
    const r = createRegistry();
    r.ingest(env("s", 0, "session.started"));
    r.ingest(env("s", 0, "message.completed", { hookEpoch: "epoch-2" }));   // reset -> stored at synthetic position 1
    r.ingestDisk("s", [{ position: 1, event: { type: "message.received" } }]);
    const rec = r.getSession("s")!;
    expect(rec.summary.degraded).toBe("epoch-reset");
    expect(rec.events.find((e) => e.position === 1)!.event.type).toBe("message.completed");
    // This pins the honest behavior: degraded sessions surface the flag; they
    // are NOT silently reconciled. (In Plan B's flow, disk scan runs only at
    // boot, before live traffic, so this ordering is an edge, not the norm.)
  });
});
