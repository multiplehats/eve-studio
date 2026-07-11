import { createFileRoute } from "@tanstack/react-router"
import type { EveMessageData } from "eve-studio"

import { ReadOnlyComposer } from "@/components/studio/composer"
import { MessageList } from "@/components/studio/message-list"
import { SessionBanners } from "@/components/studio/session-banners"
import { SessionHeader } from "@/components/studio/session-header"
import { useHealth, useSession } from "@/lib/studio-queries"

export const Route = createFileRoute("/sessions/$sessionId")({ component: SessionPage })

function SessionPage() {
  const { sessionId } = Route.useParams()
  const { data, isPending, isError } = useSession(sessionId)
  const { data: health } = useHealth()

  if (isPending) return <CenterNote text="Loading session…" />
  if (isError || !data) return <CenterNote text="Session not found — Studio may have restarted since this link was made." />

  const reduced = data.reducerError === undefined ? (data.reducedState as EveMessageData | null) : null

  return (
    <>
      <SessionHeader summary={data.summary} />
      <div className="flex min-h-0 flex-1 flex-col">
        <SessionBanners summary={data.summary} reducerError={data.reducerError} studioEveVersion={health?.eveVersion} />
        <div className="flex-1 overflow-y-auto">
          {reduced && reduced.messages.length > 0 ? (
            <MessageList messages={reduced.messages} />
          ) : (
            <CenterNote
              text={data.reducerError ? "Conversation view unavailable (reducer failed) — see banner." : "No conversation yet."}
            />
          )}
        </div>
        <div className="shrink-0 px-4 pb-4">
          <ReadOnlyComposer agent={data.summary.agent} />
        </div>
      </div>
    </>
  )
}

function CenterNote({ text }: { text: string }) {
  return <div className="text-muted-foreground flex flex-1 items-center justify-center p-8 text-sm">{text}</div>
}
