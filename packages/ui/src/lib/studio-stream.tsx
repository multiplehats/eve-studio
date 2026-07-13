import { createContext, useContext, useEffect, useState } from "react"
import type { ReactNode } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { RegistryUpdate, SessionSummary } from "eve-studio"

export type StreamStatus = "connecting" | "open" | "closed"
type StreamUpdate =
  RegistryUpdate | { kind: "session-removed"; sessionId: string }

/** Pure merge of a `kind:"session"` SSE update into the sessions list. */
export function applySessionUpdate(
  sessions: SessionSummary[] | undefined,
  session: SessionSummary
): SessionSummary[] {
  const list = sessions ?? []
  const i = list.findIndex((s) => s.sessionId === session.sessionId)
  if (i === -1) return [...list, session]
  const next = list.slice()
  next[i] = session
  return next
}

/** At most one `fn(key)` per key per `ms` window; bursts within a window coalesce. */
export function createPerKeyThrottle(
  ms: number,
  fn: (key: string) => void
): { trigger: (key: string) => void; dispose: () => void } {
  const pending = new Map<string, ReturnType<typeof setTimeout>>()
  return {
    trigger(key) {
      if (pending.has(key)) return
      pending.set(
        key,
        setTimeout(() => {
          pending.delete(key)
          fn(key)
        }, ms)
      )
    },
    dispose() {
      for (const t of pending.values()) clearTimeout(t)
      pending.clear()
    },
  }
}

export function applyRegistryUpdate(
  client: QueryClient,
  update: StreamUpdate,
  refreshSession: (sessionId: string) => void
): void {
  if (update.kind === "session") {
    client.setQueryData<SessionSummary[]>(["sessions"], (prev) =>
      applySessionUpdate(prev, update.session)
    )
    refreshSession(update.session.sessionId)
    return
  }
  if (update.kind === "event") {
    refreshSession(update.sessionId)
    return
  }
  client.setQueryData<SessionSummary[]>(["sessions"], (prev) =>
    prev?.filter((session) => session.sessionId !== update.sessionId)
  )
  client.removeQueries({ queryKey: ["session", update.sessionId] })
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } },
})

const StreamStatusContext = createContext<StreamStatus>("connecting")
export function useStreamStatus(): StreamStatus {
  return useContext(StreamStatusContext)
}

const EVENT_REFETCH_MS = 500

function StreamBridge({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<StreamStatus>("connecting")

  useEffect(() => {
    const es = new EventSource("/api/stream")
    const throttle = createPerKeyThrottle(EVENT_REFETCH_MS, (sessionId) => {
      void queryClient.invalidateQueries({ queryKey: ["session", sessionId] })
    })
    es.onopen = () => setStatus("open")
    // EventSource reconnects on its own; the server replays a full snapshot on reconnect.
    es.onerror = () => setStatus("closed")
    es.addEventListener("snapshot", (e) => {
      const { sessions } = JSON.parse(e.data) as {
        sessions: SessionSummary[]
      }
      queryClient.setQueryData(["sessions"], sessions)
    })
    es.addEventListener("update", (e) => {
      const update = JSON.parse(e.data) as StreamUpdate
      applyRegistryUpdate(queryClient, update, (sessionId) =>
        throttle.trigger(sessionId)
      )
    })
    return () => {
      throttle.dispose()
      es.close()
    }
  }, [])

  return (
    <StreamStatusContext.Provider value={status}>
      {children}
    </StreamStatusContext.Provider>
  )
}

export function StudioProvider({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <StreamBridge>{children}</StreamBridge>
    </QueryClientProvider>
  )
}
