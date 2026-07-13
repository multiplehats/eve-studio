import { createFileRoute } from "@tanstack/react-router"
import type { EveMessageData } from "eve-studio"

import { ReadOnlyComposer } from "@/components/studio/composer"
import { MessageList } from "@/components/studio/message-list"
import { SessionBanners } from "@/components/studio/session-banners"
import { SessionHeader } from "@/components/studio/session-header"
import { TranscriptViewport } from "@/components/studio/transcript-viewport"
import { useHealth, useSession } from "@/lib/studio-queries"

export const Route = createFileRoute("/sessions/$sessionId")({
  component: SessionPage,
})

function SessionPage() {
  const { sessionId } = Route.useParams()
  const { data, isPending, isError } = useSession(sessionId)
  const { data: health } = useHealth()

  if (isPending) return <CenterNote text="Loading session…" />
  if (isError)
    return (
      <CenterNote text="Session not found. Studio may have restarted since this link was made." />
    )

  const reduced = data.reducedState as EveMessageData | null

  return (
    <>
      <SessionHeader summary={data.summary} />
      <div className="flex min-h-0 flex-1 flex-col">
        <SessionBanners
          summary={data.summary}
          diagnostics={data.diagnostics}
          diagnosticCount={data.diagnosticCount}
          studioEveVersion={health?.eveVersion}
        />
        <TranscriptViewport
          sessionId={sessionId}
          contentVersion={data.reducedUpTo}
        >
          {reduced && reduced.messages.length > 0 ? (
            <MessageList
              sessionId={sessionId}
              messages={reduced.messages}
              events={data.events}
            />
          ) : (
            <CenterNote text="No conversation yet." />
          )}
        </TranscriptViewport>
        <div className="shrink-0 px-4 pb-4">
          <ReadOnlyComposer agent={data.summary.agent} />
        </div>
      </div>
    </>
  )
}

function CenterNote({ text }: { text: string }) {
  return (
    <div className="flex flex-1 items-center justify-center p-8 text-sm text-muted-foreground">
      {text}
    </div>
  )
}
