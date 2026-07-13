import type { CSSProperties, ReactNode } from "react"

import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"

import { AppSidebar } from "./app-sidebar"

export function SidebarShell({ children }: { children: ReactNode }) {
  return (
    <SidebarProvider
      className="h-svh bg-muted"
      style={{ "--sidebar-width": "255px" } as CSSProperties}
    >
      <AppSidebar />
      <SidebarInset className="m-2 flex min-h-0 flex-col overflow-hidden rounded-lg bg-background shadow-sm ring-1 ring-sidebar-border md:ml-0">
        {children}
      </SidebarInset>
    </SidebarProvider>
  )
}
