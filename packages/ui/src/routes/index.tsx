import { createFileRoute } from "@tanstack/react-router"

import { Logo } from "@/components/studio/logo"

export const Route = createFileRoute("/")({ component: EmptyState })

function EmptyState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 py-12 text-center">
      <Logo className="size-11" />
      <h1 className="mt-4 text-xl font-semibold tracking-tight">Eve Studio</h1>
      <p className="text-muted-foreground mt-1.5 text-sm">
        Select a session from the sidebar — or run your agent to see it appear live.
      </p>
    </div>
  )
}
