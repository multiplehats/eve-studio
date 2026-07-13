import { SidebarTrigger } from "@/components/ui/sidebar"
import { Logo } from "./logo"

export function EmptyState() {
  return (
    <div className="relative flex flex-1 flex-col items-center justify-center px-4 py-12 text-center">
      <SidebarTrigger
        aria-label="Toggle session sidebar"
        className="absolute top-3 left-3 hidden group-has-data-[collapsible=icon]/sidebar-wrapper:flex max-md:flex"
      />
      <Logo className="size-11" />
      <h1 className="mt-4 text-xl font-semibold tracking-tight">Eve Studio</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">
        Select a session from the sidebar, or run your agent to see it appear
        live.
      </p>
    </div>
  )
}
