import { useMemo, useState } from "react"
import type { EveMessage, StoredEvent } from "eve-studio"

import { formatDuration, groupTurns, type Turn } from "@/lib/session-turns"
import { ArrowRight01Icon, Clock01Icon, Wrench01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { PartView } from "./message-parts"
import { TurnDrawer } from "./turn-drawer"

export function MessageList({
  messages,
  events = [],
}: {
  messages: readonly EveMessage[]
  events?: readonly StoredEvent[]
}) {
  const turns = useMemo(() => groupTurns(messages, events), [messages, events])
  const [openTurn, setOpenTurn] = useState<Turn | null>(null)

  return (
    <>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-7 px-4 py-8">
        {turns.map((turn) => (
          <TurnView key={turn.id} turn={turn} onOpen={() => setOpenTurn(turn)} />
        ))}
      </div>
      <TurnDrawer
        turn={openTurn}
        onOpenChange={(open) => {
          if (!open) setOpenTurn(null)
        }}
      />
    </>
  )
}

function TurnView({ turn, onOpen }: { turn: Turn; onOpen: () => void }) {
  return (
    <>
      {turn.user && (
        <div className="bg-muted ml-auto max-w-[85%] rounded-2xl px-4 py-2.5">
          {turn.user.parts.map((part, i) => (
            <PartView key={i} part={part} />
          ))}
        </div>
      )}
      {turn.assistant && (
        <div className="flex min-w-0 flex-col gap-2">
          <TurnMetaRow turn={turn} onOpen={onOpen} />
          {turn.assistant.parts.map((part, i) => (
            <PartView key={i} part={part} />
          ))}
          {turn.assistant.metadata?.status === "streaming" && (
            <span className="bg-foreground/70 h-4 w-2 animate-pulse rounded-sm" aria-label="streaming" />
          )}
        </div>
      )}
    </>
  )
}

// Clickable per-turn summary — the only affordance that opens the drawer (inline
// tool cards keep their own expand). Shows the tool/step counts we have; turn
// duration is intentionally absent (not in the captured event stream).
function TurnMetaRow({ turn, onOpen }: { turn: Turn; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Open turn ${turn.id} — view and copy`}
      className="text-muted-foreground hover:text-foreground hover:bg-muted -mx-1.5 flex w-fit cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs transition-colors"
    >
      {turn.toolCount > 0 && (
        <span className="flex items-center gap-1">
          <HugeiconsIcon icon={Wrench01Icon} className="size-3.5" strokeWidth={2} aria-hidden="true" />
          {turn.toolCount} {turn.toolCount === 1 ? "tool" : "tools"}
        </span>
      )}
      {turn.durationMs !== undefined && (
        <span className="flex items-center gap-1">
          <HugeiconsIcon icon={Clock01Icon} className="size-3.5" strokeWidth={2} aria-hidden="true" />
          {formatDuration(turn.durationMs)}
        </span>
      )}
      <span className="font-medium">View &amp; copy</span>
      <HugeiconsIcon icon={ArrowRight01Icon} className="size-3.5" strokeWidth={2} aria-hidden="true" />
    </button>
  )
}
