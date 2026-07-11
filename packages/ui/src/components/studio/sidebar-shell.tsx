import { type CSSProperties, type ReactNode } from "react"

import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"

import { AppSidebar } from "./app-sidebar"

export function SidebarShell({ children }: { children: ReactNode }) {
  return (
    <SidebarProvider
      className="bg-muted h-svh"
      style={{ "--sidebar-width": "255px" } as CSSProperties}
    >
      <AppSidebar />
      <SidebarInset className="bg-background ring-sidebar-border m-2 flex min-h-0 flex-col overflow-hidden rounded-lg shadow-sm ring-1 md:ml-0">
        {children}
      </SidebarInset>
    </SidebarProvider>
  )
}
