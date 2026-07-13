import type { EveMessage, StoredEvent } from "eve-studio"

// A turn = one user message and the assistant work it triggered. Grouped from
// the reduced message list so each turn can be inspected and copied on its own.
export interface Turn {
  id: string
  index: number
  user?: EveMessage
  assistant?: EveMessage
  toolCount: number
  stepCount: number
  startedAt?: number
  endedAt?: number
  durationMs?: number
}

/** The wire event's own timestamp (`meta.at`), not the collector's receive time. */
function eventAt(event: { type: string; data?: unknown }): number | undefined {
  const at = (event as { meta?: { at?: unknown } }).meta?.at
  if (typeof at !== "string") return undefined
  const ms = Date.parse(at)
  return Number.isFinite(ms) ? ms : undefined
}

interface RawTiming {
  startedAt?: number
  endedAt?: number
  minAt?: number
  maxAt?: number
}
export interface TurnTiming {
  startedAt?: number
  endedAt?: number
  durationMs?: number
}

/**
 * Per-turn wall-clock timing, keyed by `turnId`, derived from each raw event's
 * `meta.at`. Prefers explicit turn.started/turn.completed bounds, falling back
 * to the min/max event time so an in-flight or boundary-less turn still gets a
 * best-effort duration.
 */
export function computeTurnTimings(
  events: readonly StoredEvent[]
): Map<string, TurnTiming> {
  const raw = new Map<string, RawTiming>()
  for (const stored of events) {
    const { event } = stored
    const turnId = (event.data as { turnId?: unknown } | undefined)?.turnId
    if (typeof turnId !== "string") continue
    const at = eventAt(event)
    if (at === undefined) continue
    const t = raw.get(turnId) ?? {}
    if (event.type === "turn.started") t.startedAt = at
    else if (event.type === "turn.completed" || event.type === "turn.failed")
      t.endedAt = at
    t.minAt = t.minAt === undefined ? at : Math.min(t.minAt, at)
    t.maxAt = t.maxAt === undefined ? at : Math.max(t.maxAt, at)
    raw.set(turnId, t)
  }
  const out = new Map<string, TurnTiming>()
  for (const [id, t] of raw) {
    const startedAt = t.startedAt ?? t.minAt
    const endedAt = t.endedAt ?? t.maxAt
    const durationMs =
      startedAt !== undefined && endedAt !== undefined
        ? endedAt - startedAt
        : undefined
    out.set(id, { startedAt, endedAt, durationMs })
  }
  return out
}

/** Human duration: `820ms`, `3s`, `46s`, `2m 15s`. */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`
  const totalSec = Math.round(ms / 1000)
  if (totalSec < 60) return `${totalSec}s`
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return s ? `${m}m ${s}s` : `${m}m`
}

/**
 * Groups the reduced messages into turns. A new turn starts at each user
 * message; the following assistant message attaches to it. The id prefers the
 * assistant's `metadata.turnId` (falling back to `turn-<index>`), which is also
 * the join key for per-turn timing from `events`.
 */
export function groupTurns(
  messages: readonly EveMessage[],
  events: readonly StoredEvent[] = []
): Turn[] {
  const turns: Turn[] = []

  for (const message of messages) {
    const last = turns.at(-1)
    if (message.role === "user") {
      turns.push({
        id: "",
        index: turns.length,
        user: message,
        toolCount: 0,
        stepCount: 0,
      })
    } else if (last && last.assistant === undefined) {
      last.assistant = message
    } else {
      turns.push({
        id: "",
        index: turns.length,
        assistant: message,
        toolCount: 0,
        stepCount: 0,
      })
    }
  }

  const timings = computeTurnTimings(events)

  for (const turn of turns) {
    const a = turn.assistant
    turn.id = a?.metadata?.turnId ?? `turn-${turn.index}`
    if (a) {
      const steps = new Set<number>()
      for (const part of a.parts) {
        if (part.type === "dynamic-tool") turn.toolCount++
        if ("stepIndex" in part && typeof part.stepIndex === "number")
          steps.add(part.stepIndex)
      }
      turn.stepCount = steps.size
    }
    const timing = timings.get(turn.id)
    if (timing) {
      turn.startedAt = timing.startedAt
      turn.endedAt = timing.endedAt
      turn.durationMs = timing.durationMs
    }
  }

  return turns
}
