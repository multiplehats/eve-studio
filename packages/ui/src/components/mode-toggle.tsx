import { ComputerIcon, Moon02Icon, Sun03Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

import { useTheme } from "./theme-provider"

export function ModeToggle() {
  const { setTheme } = useTheme()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            aria-label="Toggle theme"
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground group-data-[collapsible=icon]:hidden hover:text-foreground"
          >
            <HugeiconsIcon
              icon={Sun03Icon}
              strokeWidth={2}
              className="size-3.5 scale-100 rotate-0 transition-all dark:scale-0 dark:-rotate-90"
              aria-hidden="true"
            />
            <HugeiconsIcon
              icon={Moon02Icon}
              strokeWidth={2}
              className="absolute size-3.5 scale-0 rotate-90 transition-all dark:scale-100 dark:rotate-0"
              aria-hidden="true"
            />
          </Button>
        }
      />
      <DropdownMenuContent align="end" side="top" className="w-auto min-w-28">
        <DropdownMenuItem onClick={() => setTheme("light")}>
          <HugeiconsIcon icon={Sun03Icon} strokeWidth={2} aria-hidden="true" />
          Light
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("dark")}>
          <HugeiconsIcon icon={Moon02Icon} strokeWidth={2} aria-hidden="true" />
          Dark
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("system")}>
          <HugeiconsIcon
            icon={ComputerIcon}
            strokeWidth={2}
            aria-hidden="true"
          />
          System
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
