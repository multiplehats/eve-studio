import type {
  ProjectionDiagnostic,
  SessionSummary,
  StoredEvent,
} from "eve-studio"

export interface SessionDetail {
  summary: SessionSummary
  events: StoredEvent[]
  reducedState: unknown
  reducedUpTo: number
  diagnostics: ProjectionDiagnostic[]
  diagnosticCount: number
}

export interface StudioHealth {
  ok: boolean
  name: string
  sessions: number
  studioVersion?: string
  eveVersion?: string
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path)
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`)
  return (await res.json()) as T
}

export async function fetchSessions(): Promise<SessionSummary[]> {
  return (await get<{ sessions: SessionSummary[] }>("/api/sessions")).sessions
}

export function fetchSession(sessionId: string): Promise<SessionDetail> {
  return get<SessionDetail>(`/api/sessions/${encodeURIComponent(sessionId)}`)
}

export function fetchHealth(): Promise<StudioHealth> {
  return get<StudioHealth>("/health")
}
