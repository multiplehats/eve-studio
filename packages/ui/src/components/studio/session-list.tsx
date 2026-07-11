import { Link, useParams } from "@tanstack/react-router"
import type { SessionSummary } from "eve-studio"

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { STATUS_META, groupByProject, shortSessionId, timeAgo } from "@/lib/session-meta"
import { useSessions } from "@/lib/studio-queries"

export function SessionList() {
  const { data: sessions } = useSessions()
  const params = useParams({ strict: false }) as { sessionId?: string }
  const groups = groupByProject(sessions ?? [])

  if (groups.length === 0) {
    return (
      <SidebarGroup className="group-data-[collapsible=icon]:hidden">
        <SidebarGroupLabel>Sessions</SidebarGroupLabel>
        <SidebarGroupContent>
          <p className="text-muted-foreground px-2 py-1.5 text-xs">
            Waiting for sessions — run your agent with the extension mounted.
          </p>
        </SidebarGroupContent>
      </SidebarGroup>
    )
  }

  return (
    <>
      {groups.map(([project, list]) => (
        <SidebarGroup key={project} className="group-data-[collapsible=icon]:hidden">
          <SidebarGroupLabel className="truncate">{project}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.25">
              {list.map((s) => (
                <SessionRow key={s.sessionId} session={s} isActive={s.sessionId === params.sessionId} />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      ))}
    </>
  )
}

function SessionRow({ session, isActive }: { session: SessionSummary; isActive: boolean }) {
  const meta = STATUS_META[session.status]
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={isActive}
        className="h-auto items-start py-2"
        render={<Link to="/sessions/$sessionId" params={{ sessionId: session.sessionId }} />}
      >
        <span aria-label={meta.label} className={`mt-1.5 size-2 shrink-0 rounded-full ${meta.dotClass}`} />
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-sm font-medium">{session.agent || "unknown agent"}</span>
          <span className="text-muted-foreground truncate text-xs tabular-nums">
            {shortSessionId(session.sessionId)} · {session.eventCount} events · {timeAgo(session.updatedAt)}
          </span>
        </span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}
