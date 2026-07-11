import { Badge, type BadgeProps } from "@/components/reui/badge"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"
import { ArrowDown01Icon, Wrench01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { EveDynamicToolPart } from "eve-studio"
import type { ComponentProps } from "react"

// Vendored from AI Elements (elements.ai-sdk.dev) `tool`, adapted to this
// project's stack: Base UI collapsible (not Radix), ReUI Badge, hugeicons, and
// a plain <pre> for payloads (AI Elements' CodeBlock/shiki is roadmap item A5).
// Eve's dynamic-tool part carries 3 states beyond AI Elements' canonical four
// (the approval/denied HITL states), kept here so nothing is lost until B3
// (Confirmation) lands.
type ToolState = EveDynamicToolPart["state"]

const TOOL_STATE: Record<ToolState, { label: string; variant: BadgeProps["variant"] }> = {
  "input-streaming": { label: "calling…", variant: "info-light" },
  "input-available": { label: "called", variant: "info-light" },
  "approval-requested": { label: "awaiting approval", variant: "warning-light" },
  "approval-responded": { label: "approval answered", variant: "warning-light" },
  "output-available": { label: "done", variant: "success-light" },
  "output-error": { label: "error", variant: "destructive-light" },
  "output-denied": { label: "denied", variant: "destructive-light" },
}

export type ToolProps = ComponentProps<typeof Collapsible>

export function Tool({ className, ...props }: ToolProps) {
  return (
    <Collapsible
      className={cn("not-prose w-full rounded-md border text-sm", className)}
      {...props}
    />
  )
}

export type ToolHeaderProps = { name: string; state: ToolState; className?: string }

export function ToolHeader({ name, state, className }: ToolHeaderProps) {
  const meta = TOOL_STATE[state] ?? { label: state, variant: "outline" as const }
  return (
    <CollapsibleTrigger
      className={cn(
        "group flex w-full items-center justify-between gap-4 px-3 py-2",
        className,
      )}
    >
      <span className="flex min-w-0 items-center gap-2">
        <HugeiconsIcon
          icon={Wrench01Icon}
          className="text-muted-foreground size-4 shrink-0"
          strokeWidth={2}
          aria-hidden="true"
        />
        <span className="truncate font-mono text-xs font-medium">{name}</span>
        <Badge variant={meta.variant} size="sm">
          {meta.label}
        </Badge>
      </span>
      <HugeiconsIcon
        icon={ArrowDown01Icon}
        className="text-muted-foreground size-4 shrink-0 transition-transform group-data-[panel-open]:rotate-180"
        strokeWidth={2}
        aria-hidden="true"
      />
    </CollapsibleTrigger>
  )
}

export type ToolContentProps = ComponentProps<typeof CollapsibleContent>

export function ToolContent({ className, ...props }: ToolContentProps) {
  return (
    <CollapsibleContent
      className={cn("text-popover-foreground border-t outline-none", className)}
      {...props}
    />
  )
}

function ToolJson({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="space-y-1.5 p-3">
      <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
        {label}
      </p>
      <pre className="bg-muted/50 max-h-64 overflow-auto rounded p-2 text-xs whitespace-pre-wrap">
        {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
      </pre>
    </div>
  )
}

export type ToolInputProps = { input: unknown }

export function ToolInput({ input }: ToolInputProps) {
  return <ToolJson label="Parameters" value={input} />
}

export type ToolOutputProps = { output?: unknown; errorText?: string }

export function ToolOutput({ output, errorText }: ToolOutputProps) {
  if (output === undefined && errorText === undefined) return null
  if (errorText !== undefined) {
    return (
      <div className="space-y-1.5 p-3">
        <p className="text-destructive text-xs font-medium tracking-wide uppercase">
          Error
        </p>
        <div className="bg-destructive/10 text-destructive rounded p-2 text-xs whitespace-pre-wrap">
          {errorText}
        </div>
      </div>
    )
  }
  return <ToolJson label="Result" value={output} />
}
