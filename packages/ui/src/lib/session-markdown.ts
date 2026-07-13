import type { EveMessagePart } from "eve-studio"
import { formatDuration } from "./session-turns"
import type { Turn } from "./session-turns"

// Renders a single agent turn as agent-ready markdown — the transcript users
// copy out of the turn drawer and hand to their own agents. Mirrors the shape
// of Vercel's agent-turn export: Input, then a Timeline of tool calls (with
// I/O) and assistant replies.
//
// `detailed` (default) includes full tool Input/Output payloads. Summarize mode
// keeps the structure — tool names, states, reasoning, assistant text — but
// drops the large I/O blobs. (One reading of Vercel's Detailed/Summarize
// toggle; adjust if a different summary is meant.)

const TOOL_STATE_LABEL: Record<string, string> = {
  "input-streaming": "pending",
  "input-available": "pending",
  "approval-requested": "awaiting approval",
  "approval-responded": "responded",
  "output-available": "completed",
  "output-error": "error",
  "output-denied": "denied",
}

function fmtValue(value: unknown): string {
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function inputLine(part: EveMessagePart): string | null {
  switch (part.type) {
    case "text":
      return part.text.trim() ? part.text : null
    case "file":
      return `[file: ${part.mediaType}${part.filename ? ` (${part.filename})` : ""}]`
    default:
      return null
  }
}

export function turnToMarkdown(
  turn: Turn,
  opts: { detailed?: boolean } = {}
): string {
  const detailed = opts.detailed ?? true
  const out: string[] = []

  out.push("# Agent Turn")
  out.push(`ID: ${turn.id}`)

  const meta: string[] = []
  if (turn.startedAt !== undefined)
    meta.push(`Start Time: ${new Date(turn.startedAt).toISOString()}`)
  if (turn.endedAt !== undefined)
    meta.push(`End Time: ${new Date(turn.endedAt).toISOString()}`)
  if (turn.durationMs !== undefined)
    meta.push(`Duration: ${formatDuration(turn.durationMs)}`)
  if (turn.toolCount > 0) meta.push(`Tools: ${turn.toolCount}`)
  if (turn.stepCount > 0) meta.push(`Steps: ${turn.stepCount}`)
  if (meta.length > 0) {
    out.push("")
    out.push("## Metadata")
    for (const line of meta) out.push(line)
  }

  const input = (turn.user?.parts ?? [])
    .map(inputLine)
    .filter((l): l is string => l !== null)
  if (input.length > 0) {
    out.push("")
    out.push("## Input")
    out.push(input.join("\n"))
  }

  out.push("")
  out.push("## Timeline")

  for (const part of turn.assistant?.parts ?? []) {
    switch (part.type) {
      case "dynamic-tool": {
        const name = part.toolMetadata?.eve?.name ?? part.toolName
        const state = TOOL_STATE_LABEL[part.state] ?? part.state
        out.push("")
        out.push(`### ${name} → ${state}`)
        if (detailed) {
          if (part.input !== undefined)
            out.push(`Input: ${fmtValue(part.input)}`)
          if (part.output !== undefined)
            out.push(`Output: ${fmtValue(part.output)}`)
          if (part.errorText !== undefined)
            out.push(`Output: ${part.errorText}`)
        } else if (part.errorText !== undefined) {
          out.push(`Error: ${part.errorText}`)
        }
        break
      }
      case "reasoning": {
        if (!part.text.trim()) break
        out.push("")
        out.push("### Reasoning")
        out.push(part.text)
        break
      }
      case "text": {
        if (!part.text.trim()) break
        out.push("")
        out.push("### Assistant")
        out.push(part.text)
        break
      }
      case "authorization": {
        out.push("")
        out.push(`### Authorization: ${part.displayName} (${part.state})`)
        break
      }
      default:
        break
    }
  }

  out.push("")
  return out.join("\n")
}
