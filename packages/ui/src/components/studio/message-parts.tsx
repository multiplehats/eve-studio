import type { EveMessagePart } from "eve-studio"

import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning"
import { Response } from "@/components/ai-elements/response"
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool"
import { Badge } from "@/components/reui/badge"

// Renders one reduced message part. Shared by the conversation canvas
// (message-list) and the per-turn drawer so both stay visually identical.
export function PartView({ part }: { part: EveMessagePart }) {
  switch (part.type) {
    case "text":
      return <Response className="text-sm leading-relaxed">{part.text}</Response>
    case "reasoning":
      return (
        <Reasoning isStreaming={part.state === "streaming"} className="w-full">
          <ReasoningTrigger />
          <ReasoningContent>{part.text}</ReasoningContent>
        </Reasoning>
      )
    case "step-start":
      return <div className="h-1" role="separator" />
    case "dynamic-tool": {
      const name = part.toolMetadata?.eve?.name ?? part.toolName
      return (
        <Tool>
          <ToolHeader name={name} state={part.state} />
          <ToolContent>
            {part.input !== undefined && <ToolInput input={part.input} />}
            {part.output !== undefined && <ToolOutput output={part.output} />}
            {part.errorText !== undefined && <ToolOutput errorText={part.errorText} />}
          </ToolContent>
        </Tool>
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
