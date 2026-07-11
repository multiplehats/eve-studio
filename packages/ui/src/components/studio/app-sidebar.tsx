import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarTrigger,
} from "@/components/ui/sidebar"

import { ConnectionFooter } from "./connection-footer"
import { Logo } from "./logo"
import { SessionList } from "./session-list"

export function AppSidebar() {
  return (
    <Sidebar
      variant="floating"
      collapsible="icon"
      className="[&_[data-slot=sidebar-inner]]:bg-background"
    >
      <SidebarHeader>
        <div className="flex h-8 items-center justify-between gap-2">
          <span className="flex items-center gap-2 overflow-hidden">
            <Logo />
            <span className="truncate text-sm font-semibold group-data-[collapsible=icon]:hidden">
              Eve Studio
            </span>
          </span>
          <SidebarTrigger
            aria-label="Collapse sidebar"
            className="-me-1 group-data-[collapsible=icon]:hidden"
          />
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SessionList />
      </SidebarContent>

      <SidebarFooter className="pb-3">
        <ConnectionFooter />
      </SidebarFooter>
    </Sidebar>
  )
}
