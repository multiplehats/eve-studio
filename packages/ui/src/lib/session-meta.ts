import type { SessionStatus, SessionSummary } from "eve-studio"

export const STATUS_META: Record<SessionStatus, { label: string; dotClass: string }> = {
  working: { label: "Working", dotClass: "bg-emerald-500 animate-pulse" },
  waiting: { label: "Waiting", dotClass: "bg-amber-500" },
  completed: { label: "Completed", dotClass: "bg-muted-foreground/40" },
  failed: { label: "Failed", dotClass: "bg-red-500" },
}

/** Newest-updated project group first; sessions newest-first within each group. */
export function groupByProject(sessions: SessionSummary[]): Array<[string, SessionSummary[]]> {
  const groups = new Map<string, SessionSummary[]>()
  for (const s of [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)) {
    const key = s.project.name || "(unknown project)"
    const list = groups.get(key)
    if (list) list.push(s)
    else groups.set(key, [s])                              // insertion order = recency order
  }
  return [...groups.entries()]
}

export function shortSessionId(id: string): string {
  return id.length <= 12 ? id : `…${id.slice(-6)}`
}

export function formatTokens(n: number): string {
  if (n < 1_000) return String(n)
  if (n < 1_000_000) return `${(n / 1_000).toFixed(n < 10_000 ? 1 : 0)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

export function timeAgo(ts: number, now: number = Date.now()): string {
  const s = Math.max(0, Math.round((now - ts) / 1_000))
  if (s < 10) return "just now"
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}
