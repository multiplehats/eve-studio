import type { EveMessage, EveMessagePart } from "eve-studio"

import { Badge, type BadgeProps } from "@/components/reui/badge"
import { Logo } from "./logo"

export function MessageList({ messages }: { messages: readonly EveMessage[] }) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-7 px-4 py-8">
      {messages.map((m) => (
        <MessageView key={m.id} message={m} />
      ))}
    </div>
  )
}

function MessageView({ message }: { message: EveMessage }) {
  const parts = message.parts.map((p, i) => <PartView key={i} part={p} />)
  if (message.role === "user") {
    return <div className="bg-muted ml-auto max-w-[85%] rounded-2xl px-4 py-2.5">{parts}</div>
  }
  return (
    <div className="flex items-start gap-3">
      <Logo className="mt-0.5 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {parts}
        {message.metadata?.status === "streaming" && (
          <span className="bg-foreground/70 h-4 w-2 animate-pulse rounded-sm" aria-label="streaming" />
        )}
      </div>
    </div>
  )
}

const TOOL_STATE: Record<string, { label: string; variant: BadgeProps["variant"] }> = {
  "input-streaming": { label: "calling…", variant: "info-light" },
  "input-available": { label: "called", variant: "info-light" },
  "approval-requested": { label: "awaiting approval", variant: "warning-light" },
  "approval-responded": { label: "approval answered", variant: "warning-light" },
  "output-available": { label: "done", variant: "success-light" },
  "output-error": { label: "error", variant: "destructive-light" },
  "output-denied": { label: "denied", variant: "destructive-light" },
}

function PartView({ part }: { part: EveMessagePart }) {
  switch (part.type) {
    case "text":
      return <p className="text-sm leading-relaxed whitespace-pre-wrap">{part.text}</p>
    case "reasoning":
      return (
        <details className="text-muted-foreground text-sm">
          <summary className="cursor-pointer text-xs font-medium select-none">Reasoning</summary>
          <p className="mt-1 border-l-2 pl-3 whitespace-pre-wrap">{part.text}</p>
        </details>
      )
    case "step-start":
      // ChatGPT-style canvas: steps read as one continuous reply, so the
      // boundary is breathing room, not a rule line.
      return <div className="h-1" role="separator" />
    case "dynamic-tool": {
      const state = TOOL_STATE[part.state] ?? { label: part.state, variant: "outline" as const }
      return (
        <details className="rounded-md border px-3 py-2 text-sm">
          <summary className="flex cursor-pointer items-center gap-2 select-none">
            <span className="font-mono text-xs font-medium">{part.toolName}</span>
            <Badge variant={state.variant} size="sm">{state.label}</Badge>
          </summary>
          {part.input !== undefined && <ToolJson label="Input" value={part.input} />}
          {part.output !== undefined && <ToolJson label="Output" value={part.output} />}
          {part.errorText !== undefined && <ToolJson label="Error" value={part.errorText} />}
        </details>
      )
    }
    case "authorization":
      return (
        <div className="rounded-md border px-3 py-2 text-sm">
          <span className="font-medium">{part.displayName}</span>{" "}
          <span className="text-muted-foreground text-xs">authorization {part.state}</span>
          {part.state === "required" && part.authorization?.url && (
            <p className="mt-1 text-xs break-all">
              {part.authorization.url}
              {part.authorization.userCode ? ` · code ${part.authorization.userCode}` : ""}
            </p>
          )}
        </div>
      )
    case "file":
      return <Badge variant="outline" className="w-fit font-mono text-xs">{part.filename ?? part.mediaType}</Badge>
    default:
      return null
  }
}

function ToolJson({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="mt-2">
      <p className="text-muted-foreground text-xs font-medium">{label}</p>
      <pre className="bg-muted mt-1 max-h-64 overflow-auto rounded p-2 text-xs whitespace-pre-wrap">
        {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
      </pre>
    </div>
  )
}
