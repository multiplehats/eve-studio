import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createRegistry } from "../src/registry.js";
import type { IngestEnvelope } from "../src/types.js";

const FIXTURE: IngestEnvelope[] = readFileSync(new URL("./fixtures/mock-eval-envelopes.ndjson", import.meta.url), "utf8")
  .trim().split("\n").map((l) => JSON.parse(l));

describe("server-side reduction", () => {
  it("rebuilds full assistant text from messageSoFar-STRIPPED deltas (the fixture is stripped)", () => {
    const r = createRegistry();
    for (const e of FIXTURE) r.ingest(e);
    const [summary] = r.getSessions();
    const rec = r.getSession(summary.sessionId)!;
    expect(rec.reducerError).toBeUndefined();
    const text = JSON.stringify(rec.reducedState);
    expect(text).toContain("MOCK[1]: ping one");           // deterministic mock responder output
    expect(text).toContain("MOCK[2]: ping two");
    expect(text).toContain("ping one");                    // the user turns
  });

  it("stalls reducedUpTo on a gap and catches up when it fills (observable regardless of event content)", () => {
    const r = createRegistry();
    const [e0, e1, e2] = FIXTURE.slice(0, 3);
    r.ingest(e0);
    r.ingest(e2);                                          // gap at position 1
    const id = e0.sessionId;
    expect(r.getSession(id)!.reducedUpTo).toBe(1);         // stalled at the gap
    r.ingest(e1);                                          // gap fills
    expect(r.getSession(id)!.reducedUpTo).toBe(3);         // caught up through position 2
    expect(r.getSession(id)!.reducerError).toBeUndefined();
  });

  it("rebases after a never-received prefix persists: mid-session attach reduces from the first held position", () => {
    let clock = 1_000;
    const r = createRegistry({ now: () => clock });
    const late = FIXTURE.slice(5);                         // positions 0-4 never arrive (Studio attached late)
    r.ingest(late[0]);
    expect(r.getSession(late[0].sessionId)!.reducedUpTo).toBe(0);   // stalled — prefix missing
    clock += 3_001;                                        // dwell (rebaseAfterMs default 3000) elapses
    for (const e of late.slice(1)) r.ingest(e);
    const rec = r.getSession(late[0].sessionId)!;
    expect(rec.summary.degraded).toBe("gap");
    expect(rec.reducedUpTo).toBe(rec.summary.maxPosition + 1);      // rebase then full catch-up
    expect(rec.reducerError).toBeUndefined();
  });

  it("cap pressure forces an immediate rebase — the byte cap survives a missing prefix", () => {
    const r = createRegistry({ maxSessionBytes: 2_000 });
    const big = "x".repeat(500);
    for (let i = 5; i < 15; i++) {
      r.ingest({ ...FIXTURE[0], seq: i, event: { type: "message.appended", data: { messageDelta: big } } });
    }
    const rec = r.getSession(FIXTURE[0].sessionId)!;
    expect(rec.summary.degraded).toBe("gap");
    expect(rec.summary.evictedBelow).toBeGreaterThan(5);   // eviction happened despite positions 0-4 never existing
  });

  it("unknown event types do not break reduction", () => {
    const r = createRegistry();
    r.ingest({ ...FIXTURE[0] });
    r.ingest({ ...FIXTURE[0], seq: 1, event: { type: "totally.unknown.v99", data: { x: 1 } } });
    const rec = r.getSession(FIXTURE[0].sessionId)!;
    expect(rec.reducerError).toBeUndefined();
  });

  it("never evicts unreduced events; evicted reduced events survive in reducedState", () => {
    // Fixture totals 1,814 bytes of event JSON (DEVIATIONS §Plan B Task 5) — under 2,000,
    // so the cap is lowered to 1,000 here to force eviction on the real fixture session.
    const r = createRegistry({ maxSessionBytes: 1_000 });
    for (const e of FIXTURE) r.ingest(e);                  // small cap forces eviction on the real session
    const [summary] = r.getSessions();
    const rec = r.getSession(summary.sessionId)!;
    expect(summary.evictedBelow).toBeGreaterThan(0);       // eviction actually happened
    expect(JSON.stringify(rec.reducedState)).toContain("MOCK[1]: ping one"); // content survives raw eviction
  });
});
