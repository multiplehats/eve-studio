import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { turnToMarkdown } from "@/lib/session-markdown"
import type { Turn } from "@/lib/session-turns"
import { cn } from "@/lib/utils"
import { Copy01Icon, Tick02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"

// Right-side drawer for one agent turn. Shows the RAW markdown that Copy
// produces (what users hand to their agents) — not the rendered tool cards —
// toggled between Detailed (full I/O) and Summarize (structure only).
export function TurnDrawer({
  turn,
  onOpenChange,
}: {
  turn: Turn | null
  onOpenChange: (open: boolean) => void
}) {
  const [detailed, setDetailed] = useState(true)
  const [copied, setCopied] = useState(false)

  const markdown = turn ? turnToMarkdown(turn, { detailed }) : ""

  async function copy() {
    if (!turn) return
    try {
      await navigator.clipboard.writeText(markdown)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard blocked (insecure context / permissions) — silently no-op.
    }
  }

  return (
    <Sheet open={turn != null} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-xl">
        {turn && (
          <>
            <SheetHeader className="flex-row items-center gap-2 border-b p-3 pr-12">
              <SheetTitle className="font-mono">{turn.id}</SheetTitle>
              <div className="ml-auto flex items-center gap-1.5">
                <div className="bg-muted flex rounded-md p-0.5 text-xs">
                  <button
                    type="button"
                    onClick={() => setDetailed(true)}
                    className={cn(
                      "cursor-pointer rounded px-2 py-0.5 transition-colors",
                      detailed ? "bg-background shadow-sm" : "text-muted-foreground",
                    )}
                  >
                    Detailed
                  </button>
                  <button
                    type="button"
                    onClick={() => setDetailed(false)}
                    className={cn(
                      "cursor-pointer rounded px-2 py-0.5 transition-colors",
                      !detailed ? "bg-background shadow-sm" : "text-muted-foreground",
                    )}
                  >
                    Summarize
                  </button>
                </div>
                <Button variant="outline" size="sm" onClick={copy} className="gap-1.5">
                  <HugeiconsIcon
                    icon={copied ? Tick02Icon : Copy01Icon}
                    className="size-3.5"
                    strokeWidth={2}
                    aria-hidden="true"
                  />
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
            </SheetHeader>

            <div className="min-h-0 flex-1 overflow-auto p-4">
              <pre className="text-foreground font-mono text-xs leading-relaxed break-words whitespace-pre-wrap">
                {markdown}
              </pre>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
