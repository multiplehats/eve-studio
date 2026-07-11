import { useQuery } from "@tanstack/react-query"
import { fetchHealth, fetchSession, fetchSessions } from "./studio-api"

/** Seeded/kept fresh by the SSE bridge; the fetch is the cold-start fallback. */
export function useSessions() {
  return useQuery({ queryKey: ["sessions"], queryFn: fetchSessions, staleTime: Number.POSITIVE_INFINITY })
}

/** Refetched via SSE-driven invalidation (throttled per session). */
export function useSession(sessionId: string) {
  return useQuery({ queryKey: ["session", sessionId], queryFn: () => fetchSession(sessionId) })
}

export function useHealth() {
  return useQuery({ queryKey: ["health"], queryFn: fetchHealth, staleTime: Number.POSITIVE_INFINITY })
}
