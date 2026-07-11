export interface HookCtxLike {
  agent?: { name?: string };
  session?: { id?: string };
  channel?: { kind?: string };
}

export interface EnvelopeState {
  counters: Map<string, number>;
  hookEpoch: string;
  project: { name: string; root: string };
  processInfo: { instanceId: string; kind: string; pid: number };
  group?: string | undefined;   // OPTIONAL: the existing tests' state literals must stay compiling as-is
}

export interface Envelope {
  v: 1;
  project: { name: string; root: string };
  process: { instanceId: string; kind: string; pid: number };
  agent: string;
  sessionId: string;
  channelKind: string | undefined;
  group?: string;
  seq: number;
  hookEpoch: string;
  event: unknown;
}

/**
 * Long-lived hook processes see many sessions; the counters map must not grow
 * unbounded (Plan A review carry-forward 4). True LRU: touching a session
 * refreshes its recency, so only sessions idle longest are evicted. An evicted
 * session that later resumes restarts at seq 0 under the same hookEpoch, so
 * the cap is set far above realistic concurrent-session counts to keep that
 * unreachable in practice.
 */
const MAX_TRACKED_SESSIONS = 1000;

export function buildEnvelope(
  event: { type: string; data?: unknown },
  ctx: HookCtxLike,
  state: EnvelopeState,
): Envelope {
  const sessionId = ctx.session?.id ?? "unknown";
  const seq = state.counters.get(sessionId) ?? 0;
  state.counters.delete(sessionId);
  state.counters.set(sessionId, seq + 1);
  if (state.counters.size > MAX_TRACKED_SESSIONS) {
    const oldest = state.counters.keys().next().value;
    if (oldest !== undefined) state.counters.delete(oldest);
  }

  return {
    v: 1,
    project: state.project,
    process: state.processInfo,
    agent: ctx.agent?.name ?? "unknown",
    sessionId,
    channelKind: ctx.channel?.kind,
    ...(state.group !== undefined ? { group: state.group } : {}),
    seq,
    hookEpoch: state.hookEpoch,
    event: stripMessageSoFar(event),
  };
}

/**
 * Strips `messageSoFar` from `message.appended` events, recursing into
 * `subagent.event` wrappers (whose `data.event` is itself a full nested
 * stream event) to arbitrary depth. Never mutates the input at any nesting
 * level: builds fresh objects only along the path that changed, and returns
 * the original reference untouched when nothing needed stripping.
 */
function stripMessageSoFar(event: { type: string; data?: unknown }): unknown {
  if (event.type === "message.appended" && event.data && typeof event.data === "object") {
    const { messageSoFar: _dropped, ...rest } = event.data as Record<string, unknown>;
    return { ...event, data: rest };
  }

  if (
    event.type === "subagent.event" &&
    event.data &&
    typeof event.data === "object" &&
    "event" in (event.data as Record<string, unknown>)
  ) {
    const nested = (event.data as Record<string, unknown>).event;
    if (nested && typeof nested === "object" && "type" in nested) {
      const strippedNested = stripMessageSoFar(nested as { type: string; data?: unknown });
      if (strippedNested !== nested) {
        return {
          ...event,
          data: { ...(event.data as Record<string, unknown>), event: strippedNested },
        };
      }
    }
  }

  return event;
}

export function isInert(env: Record<string, string | undefined>): boolean {
  if (env.EVE_STUDIO_ENABLED === "1") return false;
  return env.NODE_ENV === "production" || env.VERCEL_ENV === "production";
}
