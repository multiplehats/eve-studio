import { useSessions } from "@/lib/studio-queries"
import { useStreamStatus, type StreamStatus } from "@/lib/studio-stream"

const STATUS_UI: Record<StreamStatus, { label: string; dot: string }> = {
  connecting: { label: "Connecting…", dot: "bg-amber-500 animate-pulse" },
  open: { label: "Live", dot: "bg-emerald-500" },
  closed: { label: "Reconnecting…", dot: "bg-red-500 animate-pulse" },
}

export function ConnectionFooter() {
  const status = useStreamStatus()
  const { data: sessions } = useSessions()
  const ui = STATUS_UI[status]
  const n = sessions?.length ?? 0
  return (
    <div className="text-muted-foreground flex items-center gap-2 px-2 py-1.5 text-xs group-data-[collapsible=icon]:justify-center">
      <span className={`size-2 shrink-0 rounded-full ${ui.dot}`} aria-hidden />
      <span className="group-data-[collapsible=icon]:hidden">
        {ui.label} · {n} session{n === 1 ? "" : "s"}
      </span>
    </div>
  )
}
