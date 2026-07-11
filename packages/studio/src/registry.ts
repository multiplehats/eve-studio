import { defaultMessageReducer } from "eve/client";
import type { IngestEnvelope, Registry, RegistryOptions, RegistryUpdate, SessionStatus, SessionSummary, SessionUsage, StoredEvent } from "./types.js";

const STATUS_BY_TYPE: Partial<Record<string, SessionStatus>> = {
  "session.failed": "failed",
  "session.completed": "completed",
  "result.completed": "completed",
  "session.waiting": "waiting",
  "input.requested": "waiting",
};

interface SessionRecord {
  summary: SessionSummary;
  events: Map<number, StoredEvent>;
  firstHookEpoch?: string;
  statusPosition: number;
  bytes: number;
  reducer: ReturnType<typeof defaultMessageReducer>;
  reduced: unknown;
  reducedUpTo: number;
  reducerError?: string;
  stallSince?: number;
}

export function createRegistry(opts: RegistryOptions = {}): Registry {
  const maxSessionBytes = opts.maxSessionBytes ?? 5_000_000;
  const now = opts.now ?? Date.now;
  const rebaseAfterMs = opts.rebaseAfterMs ?? 3_000;
  const sessions = new Map<string, SessionRecord>();
  const listeners = new Set<(u: RegistryUpdate) => void>();
  const stats = { sessions: 0, eventsAccepted: 0, duplicatesDropped: 0, malformedSkipped: 0 };

  function emit(u: RegistryUpdate): void {
    for (const fn of listeners) {
      try { fn(u); } catch { /* a bad listener must not poison ingest */ }
    }
  }

  function isValid(raw: unknown): raw is IngestEnvelope {
    if (typeof raw !== "object" || raw === null) return false;
    const e = raw as Record<string, unknown>;
    return typeof e.sessionId === "string"
      && typeof e.seq === "number" && Number.isInteger(e.seq) && e.seq >= 0
      && typeof e.hookEpoch === "string"
      && typeof e.event === "object" && e.event !== null
      && typeof (e.event as Record<string, unknown>).type === "string";
  }

  function ensure(id: string, seed: { agent?: string; project?: { name?: string; root?: string }; process?: { instanceId?: string; kind?: string }; group?: string; channelKind?: string }): SessionRecord {
    let rec = sessions.get(id);
    if (!rec) {
      const instanceId = seed.process?.instanceId ?? "unknown";
      const reducer = defaultMessageReducer();
      rec = {
        summary: {
          sessionId: id,
          agent: seed.agent ?? "unknown",
          project: { name: seed.project?.name ?? "unknown", root: seed.project?.root ?? "unknown" },
          processInstanceId: instanceId,
          processKind: seed.process?.kind ?? "unknown",
          group: seed.group ?? instanceId,
          channelKind: seed.channelKind,
          status: "working",
          usage: { inputTokens: 0, outputTokens: 0, costUsd: 0, steps: 0 },
          eventCount: 0,
          maxPosition: -1,
          evictedBelow: 0,
          updatedAt: now(),
        },
        events: new Map(),
        statusPosition: -1,
        bytes: 0,
        reducer,
        reduced: reducer.initial(),
        reducedUpTo: 0,
      };
      sessions.set(id, rec);
      stats.sessions++;
    }
    return rec;
  }

  /**
   * Reads project/process/agent identity off a live envelope into a summary
   * that was seeded with "unknown"s (a disk-discovered session that continues
   * live must not display as "unknown" forever).
   */
  function upgradeIdentity(rec: SessionRecord, e: IngestEnvelope): void {
    const s = rec.summary;
    if (s.agent === "unknown" && e.agent) s.agent = e.agent;
    if (s.project.name === "unknown" && e.project?.name) {
      s.project = { name: e.project.name, root: e.project.root ?? "unknown" };
    }
    if (s.processInstanceId === "unknown" && e.process?.instanceId) {
      s.processInstanceId = e.process.instanceId;
      s.processKind = e.process.kind ?? "unknown";
      if (s.group === "unknown") s.group = e.process.instanceId;
    }
    if (e.group) s.group = e.group;
    if (s.channelKind === undefined && e.channelKind) s.channelKind = e.channelKind;
  }

  /**
   * Usage path confirmed against the Task 2 fixture (DEVIATIONS §Plan B Task 2):
   * - step.completed usage lives at event.data.usage = { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens }
   * - session.started's eveVersion is NESTED under event.data.runtime.eveVersion (NOT event.data.eveVersion)
   */
  function accumulateUsage(rec: SessionRecord, event: { type: string; data?: unknown }): void {
    if (event.type === "session.started") {
      const runtime = (event.data as { runtime?: { eveVersion?: unknown } } | undefined)?.runtime;
      const v = runtime?.eveVersion;
      if (typeof v === "string") rec.summary.eveVersion = v;
      return;
    }
    if (event.type !== "step.completed") return;
    const u: SessionUsage = rec.summary.usage;
    u.steps++;                                             // every step counts, usage-bearing or not
    const usage = (event.data as { usage?: Record<string, unknown> } | undefined)?.usage;
    if (!usage) return;
    if (typeof usage.inputTokens === "number") u.inputTokens += usage.inputTokens;
    if (typeof usage.outputTokens === "number") u.outputTokens += usage.outputTokens;
    if (typeof usage.costUsd === "number") u.costUsd += usage.costUsd;
  }

  function accept(rec: SessionRecord, position: number, source: "live" | "disk", event: { type: string; data?: unknown }): boolean {
    if (position < rec.summary.evictedBelow || rec.events.has(position)) {
      stats.duplicatesDropped++;
      return false;
    }
    const stored: StoredEvent = { position, source, receivedAt: now(), event };
    rec.events.set(position, stored);
    rec.bytes += JSON.stringify(event).length;
    rec.summary.eventCount = rec.events.size;
    rec.summary.maxPosition = Math.max(rec.summary.maxPosition, position);
    rec.summary.updatedAt = stored.receivedAt;
    if (position >= rec.statusPosition) {
      rec.summary.status = STATUS_BY_TYPE[event.type] ?? "working";
      rec.statusPosition = position;
    }
    accumulateUsage(rec, event);
    advanceReduction(rec);
    maybeRebase(rec, false);
    evictIfNeeded(rec);
    stats.eventsAccepted++;
    emit({ kind: "event", sessionId: rec.summary.sessionId, position, event });
    emit({ kind: "session", session: rec.summary });
    return true;
  }

  function lowestStored(rec: SessionRecord): number {
    let low = Infinity;
    for (const p of rec.events.keys()) if (p < low) low = p;
    return low;
  }

  function advanceReduction(rec: SessionRecord): void {
    if (rec.reducerError !== undefined) return;
    while (rec.events.has(rec.reducedUpTo)) {
      const stored = rec.events.get(rec.reducedUpTo)!;
      try {
        rec.reduced = rec.reducer.reduce(rec.reduced as never, stored.event as never);
      } catch (err) {
        rec.reducerError = err instanceof Error ? err.message : String(err);
        return;
      }
      rec.reducedUpTo++;
    }
  }

  /**
   * Gap recovery. A gap whose prefix was never received (reducedUpTo below the
   * lowest position we hold) cannot fill from stored events — mid-session
   * attach and forwarder maxQueue overflow both produce it. After a dwell
   * (tolerates shuffled 25ms-scale batches), or immediately under cap pressure
   * (`force`), restart the reducer at the lowest held position and flag the
   * session — a degraded-but-live view beats a frozen one, and eviction needs
   * reducedUpTo to move or the byte cap is dead.
   */
  function maybeRebase(rec: SessionRecord, force: boolean): void {
    if (rec.reducerError !== undefined) return;
    const low = lowestStored(rec);
    if (!Number.isFinite(low) || rec.reducedUpTo >= low) { rec.stallSince = undefined; return; }
    rec.stallSince ??= now();
    if (force || now() - rec.stallSince > rebaseAfterMs) {
      rec.reduced = rec.reducer.initial();
      rec.reducedUpTo = low;
      rec.summary.degraded = "gap";
      rec.stallSince = undefined;
      advanceReduction(rec);
    }
  }

  function evictIfNeeded(rec: SessionRecord): void {
    while (rec.bytes > maxSessionBytes && rec.events.size > 1) {
      let victim = Infinity;
      for (const p of rec.events.keys()) if (p < rec.reducedUpTo && p < victim) victim = p;
      if (!Number.isFinite(victim)) {
        if (rec.reducerError === undefined) {
          const before = rec.reducedUpTo;
          maybeRebase(rec, true);
          if (rec.reducedUpTo === before) break;             // nothing rebasable: transient contiguous run — allow, advance will consume it
          continue;                                          // rebase moved reducedUpTo — retry the victim search
        }
        victim = lowestStored(rec);                          // reducer dead: cap survives it — evict oldest unconditionally
        if (!Number.isFinite(victim)) break;
      }
      const evicted = rec.events.get(victim)!;
      rec.events.delete(victim);
      rec.bytes -= JSON.stringify(evicted.event).length;
      rec.summary.evictedBelow = victim + 1;
      rec.summary.eventCount = rec.events.size;
    }
  }

  return {
    ingest(raw: unknown): void {
      try {
        if (!isValid(raw)) { stats.malformedSkipped++; return; }
        const rec = ensure(raw.sessionId, raw);
        upgradeIdentity(rec, raw);
        let position: number;
        if (rec.firstHookEpoch === undefined) {
          rec.firstHookEpoch = raw.hookEpoch;
          position = raw.seq;
        } else if (raw.hookEpoch !== rec.firstHookEpoch) {
          // Hook process restarted mid-session: seq is no longer a stream
          // position (Global Constraint 3). Append honestly after everything
          // we trust and flag the session. LIMITATION, surfaced via the
          // degraded flag: post-reset positions are synthetic — they no longer
          // dedup against forwarder retransmits or merge with disk positions.
          // No silent repair is attempted (design: replay/disk would have to
          // become authoritative — that reconciliation is out of Plan B scope).
          rec.summary.degraded = "epoch-reset";
          position = rec.summary.maxPosition + 1;
        } else {
          position = raw.seq;
        }
        accept(rec, position, "live", raw.event);
      } catch { stats.malformedSkipped++; }
    },

    ingestDisk(sessionId, events, meta = {}): void {
      try {
        const rec = ensure(sessionId, meta);
        for (const { position, event } of events) {
          if (!Number.isInteger(position) || position < 0 || typeof event?.type !== "string") { stats.malformedSkipped++; continue; }
          accept(rec, position, "disk", event);
        }
      } catch { stats.malformedSkipped++; }
    },

    getSessions(): SessionSummary[] {
      return [...sessions.values()].map((r) => r.summary);
    },

    getSession(id: string) {
      const rec = sessions.get(id);
      if (!rec) return undefined;
      return {
        summary: rec.summary,
        events: [...rec.events.values()].sort((a, b) => a.position - b.position),
        reducedState: rec.reduced,
        reducedUpTo: rec.reducedUpTo,
        reducerError: rec.reducerError,
      };
    },

    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    stats: () => ({ ...stats }),
  };
}
