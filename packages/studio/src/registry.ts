import { createMessageProjection, type MessageProjection } from "./message-reduction.js";
import type { IngestEnvelope, ProjectionDiagnostic, Registry, RegistryOptions, RegistryUpdate, SessionStatus, SessionSummary, SessionUsage, StoredEvent } from "./types.js";

const STATUS_BY_TYPE: Partial<Record<string, SessionStatus>> = {
  "session.failed": "failed",
  "session.completed": "completed",
  "result.completed": "completed",
  "session.waiting": "waiting",
  "input.requested": "waiting",
};

interface SessionRecord {
  summary: SessionSummary;
  events: Map<number, CachedStoredEvent>;
  createdOrder: number;
  firstHookEpoch?: string;
  statusPosition: number;
  bytes: number;
  reducer: MessageProjection;
  reduced: unknown;
  reducedUpTo: number;
  diagnostics: ProjectionDiagnostic[];
  diagnosticCount: number;
  gapSince?: number;
  gapTimer?: ReturnType<typeof setTimeout>;
}

interface CachedStoredEvent extends StoredEvent {
  byteSize: number;
}

export function createRegistry(opts: RegistryOptions = {}): Registry {
  const maxSessionBytes = opts.maxSessionBytes ?? 5_000_000;
  const configuredMaxSessions = opts.maxSessions ?? 200;
  const maxSessions = Number.isInteger(configuredMaxSessions) && configuredMaxSessions > 0 ? configuredMaxSessions : 200;
  const now = opts.now ?? Date.now;
  const rebaseAfterMs = opts.rebaseAfterMs ?? 3_000;
  const sessions = new Map<string, SessionRecord>();
  const listeners = new Set<(u: RegistryUpdate) => void>();
  const stats = { sessions: 0, eventsAccepted: 0, duplicatesDropped: 0, malformedSkipped: 0 };
  let nextCreatedOrder = 0;

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
      const reducer = createMessageProjection();
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
        createdOrder: nextCreatedOrder++,
        statusPosition: -1,
        bytes: 0,
        reducer,
        reduced: reducer.initial(),
        reducedUpTo: 0,
        diagnostics: [],
        diagnosticCount: 0,
      };
      sessions.set(id, rec);
      stats.sessions++;
      enforceSessionCap(rec);
    }
    return rec;
  }

  function clearGapTimer(rec: SessionRecord): void {
    if (rec.gapTimer !== undefined) clearTimeout(rec.gapTimer);
    rec.gapTimer = undefined;
  }

  function removeSession(rec: SessionRecord): void {
    clearGapTimer(rec);
    if (!sessions.delete(rec.summary.sessionId)) return;
    stats.sessions--;
    emit({ kind: "session-removed", sessionId: rec.summary.sessionId });
  }

  function oldest(records: SessionRecord[]): SessionRecord | undefined {
    return records.sort((a, b) =>
      a.summary.updatedAt - b.summary.updatedAt
      || a.createdOrder - b.createdOrder
      || a.summary.sessionId.localeCompare(b.summary.sessionId)
    )[0];
  }

  function enforceSessionCap(protectedRecord: SessionRecord): void {
    while (sessions.size > maxSessions) {
      const records = [...sessions.values()].filter((rec) => rec !== protectedRecord);
      const terminal = records.filter((rec) => rec.summary.status === "completed" || rec.summary.status === "failed");
      const victim = oldest(terminal.length > 0 ? terminal : records);
      if (victim === undefined) return;
      removeSession(victim);
    }
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
    const serialized = JSON.stringify(event);
    const stored: CachedStoredEvent = {
      position,
      source,
      receivedAt: now(),
      byteSize: Buffer.byteLength(serialized, "utf8"),
      event,
    };
    rec.events.set(position, stored);
    rec.bytes += stored.byteSize;
    rec.summary.eventCount = rec.events.size;
    rec.summary.maxPosition = Math.max(rec.summary.maxPosition, position);
    rec.summary.updatedAt = stored.receivedAt;
    if (position >= rec.statusPosition) {
      rec.summary.status = STATUS_BY_TYPE[event.type] ?? "working";
      rec.statusPosition = position;
    }
    accumulateUsage(rec, event);
    advanceReduction(rec);
    manageGap(rec, false);
    evictIfNeeded(rec);
    stats.eventsAccepted++;
    emit({ kind: "event", sessionId: rec.summary.sessionId, position });
    emit({ kind: "session", session: rec.summary });
    return true;
  }

  function lowestStored(rec: SessionRecord): number {
    let low = Infinity;
    for (const p of rec.events.keys()) if (p < low) low = p;
    return low;
  }

  function diagnosticMessage(err: unknown): string {
    if (!(err instanceof Error)) return "Projection reducer threw a non-Error value.";
    const normalized = err.message.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
    return (normalized || "Projection reducer failed.").slice(0, 240);
  }

  function appendDiagnostic(rec: SessionRecord, stored: StoredEvent, err: unknown): void {
    rec.diagnosticCount++;
    rec.diagnostics.push({
      position: stored.position,
      eventType: stored.event.type,
      message: diagnosticMessage(err),
    });
    if (rec.diagnostics.length > 5) rec.diagnostics.splice(0, rec.diagnostics.length - 5);
  }

  function advanceReduction(rec: SessionRecord): void {
    while (rec.events.has(rec.reducedUpTo)) {
      const stored = rec.events.get(rec.reducedUpTo)!;
      try {
        rec.reduced = rec.reducer.reduce(rec.reduced as never, stored.event as never);
      } catch (err) {
        appendDiagnostic(rec, stored, err);
      }
      rec.reducedUpTo++;
    }
  }

  function nextStoredAfterGap(rec: SessionRecord): number {
    let next = Infinity;
    for (const position of rec.events.keys()) {
      if (position > rec.reducedUpTo && position < next) next = position;
    }
    return next;
  }

  function recoverGap(rec: SessionRecord, next: number): void {
    const isLeadingGap = rec.reducedUpTo === 0;
    clearGapTimer(rec);
    rec.gapSince = undefined;
    if (isLeadingGap) {
      rec.reducer = createMessageProjection();
      rec.reduced = rec.reducer.initial();
    }
    rec.reducedUpTo = next;
    rec.summary.degraded = "gap";
    advanceReduction(rec);
  }

  function manageGap(rec: SessionRecord, force: boolean): void {
    if (rec.events.has(rec.reducedUpTo)) {
      clearGapTimer(rec);
      rec.gapSince = undefined;
      return;
    }
    const next = nextStoredAfterGap(rec);
    if (!Number.isFinite(next)) {
      clearGapTimer(rec);
      rec.gapSince = undefined;
      return;
    }

    rec.gapSince ??= now();
    const elapsed = Math.max(0, now() - rec.gapSince);
    if (force || elapsed >= rebaseAfterMs) {
      recoverGap(rec, next);
      return;
    }
    if (rec.gapTimer !== undefined) return;

    rec.gapTimer = setTimeout(() => {
      rec.gapTimer = undefined;
      if (!sessions.has(rec.summary.sessionId)) return;
      const before = rec.reducedUpTo;
      manageGap(rec, false);
      if (rec.reducedUpTo !== before) {
        manageGap(rec, false);
        emit({ kind: "session", session: rec.summary });
      }
    }, Math.max(0, rebaseAfterMs - elapsed));
    rec.gapTimer.unref?.();
  }

  function evictIfNeeded(rec: SessionRecord): void {
    while (rec.bytes > maxSessionBytes && rec.events.size > 1) {
      let victim = Infinity;
      for (const p of rec.events.keys()) if (p < rec.reducedUpTo && p < victim) victim = p;
      if (!Number.isFinite(victim)) {
        const before = rec.reducedUpTo;
        manageGap(rec, true);
        if (rec.reducedUpTo === before) break;
        continue;
      }
      const evicted = rec.events.get(victim)!;
      rec.events.delete(victim);
      rec.bytes -= evicted.byteSize;
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
          // degraded flag: post-reset positions are synthetic. They no longer
          // dedup against forwarder retransmits or merge with disk positions.
          // No silent repair is attempted (design: replay/disk would have to
          // become authoritative, and that reconciliation is out of Plan B scope).
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
        events: [...rec.events.values()]
          .sort((a, b) => a.position - b.position)
          .map(({ byteSize: _byteSize, ...event }) => event),
        reducedState: rec.reduced,
        reducedUpTo: rec.reducedUpTo,
        diagnostics: rec.diagnostics,
        diagnosticCount: rec.diagnosticCount,
      };
    },

    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    stats: () => ({ ...stats }),
  };
}
