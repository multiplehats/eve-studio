import type { SessionSummary } from "eve-studio"

import { Badge } from "@/components/reui/badge"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { STATUS_META, formatTokens, shortSessionId } from "@/lib/session-meta"

export function SessionHeader({ summary }: { summary: SessionSummary }) {
  const meta = STATUS_META[summary.status]
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 px-3 lg:px-4">
      <SidebarTrigger
        aria-label="Toggle sidebar"
        className="-ml-1 hidden group-has-data-[collapsible=icon]/sidebar-wrapper:flex max-md:flex"
      />
      <Separator
        orientation="vertical"
        className="hidden h-5 group-has-data-[collapsible=icon]/sidebar-wrapper:block data-vertical:self-center max-md:block"
      />
      <span className={`size-2 shrink-0 rounded-full ${meta.dotClass}`} aria-label={meta.label} />
      <span className="truncate text-sm font-semibold">{summary.agent || "unknown agent"}</span>
      <span className="text-muted-foreground truncate font-mono text-xs">{shortSessionId(summary.sessionId)}</span>
      <Badge variant="outline" className="ml-auto tabular-nums">
        ↑{formatTokens(summary.usage.inputTokens)} ↓{formatTokens(summary.usage.outputTokens)} tok
      </Badge>
      <Badge variant="outline" className="tabular-nums">{summary.usage.steps} steps</Badge>
      {summary.usage.costUsd > 0 && (
        <Badge variant="outline" className="tabular-nums">${summary.usage.costUsd.toFixed(4)}</Badge>
      )}
    </header>
  )
}
