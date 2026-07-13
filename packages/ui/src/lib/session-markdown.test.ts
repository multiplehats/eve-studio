import { describe, expect, it } from "vitest"
import type { EveMessage, StoredEvent } from "eve-studio"
import { turnToMarkdown } from "./session-markdown"
import { groupTurns } from "./session-turns"

const messages: EveMessage[] = [
  {
    id: "u1",
    role: "user",
    parts: [
      { type: "text", text: "What time is it?" },
      { type: "file", mediaType: "image/jpeg", filename: "photo.jpg" },
    ],
  },
  {
    id: "a1",
    role: "assistant",
    metadata: { status: "complete", turnId: "turn_0" },
    parts: [
      {
        type: "dynamic-tool",
        toolCallId: "t1",
        toolName: "get_current_time",
        state: "output-available",
        input: {},
        output: { iso: "2026-07-11T07:49:32Z" },
      },
      { type: "text", text: "It is 07:49 UTC.", state: "done" },
    ],
  },
]

describe("turnToMarkdown", () => {
  const [turn] = groupTurns(messages)

  it("detailed: renders input (incl. files), tool I/O, and assistant reply in order", () => {
    const md = turnToMarkdown(turn, { detailed: true })
    expect(md).toContain("# Agent Turn")
    expect(md).toContain("ID: turn_0")
    expect(md).toContain("## Input")
    expect(md).toContain("What time is it?")
    expect(md).toContain("[file: image/jpeg (photo.jpg)]")
    expect(md).toContain("### get_current_time → completed")
    expect(md).toContain("Input: {}")
    expect(md).toContain('Output: {"iso":"2026-07-11T07:49:32Z"}')
    expect(md).toContain("### Assistant\nIt is 07:49 UTC.")
    expect(md.indexOf("## Input")).toBeLessThan(md.indexOf("## Timeline"))
  })

  it("summarize: keeps structure but drops the I/O payloads", () => {
    const md = turnToMarkdown(turn, { detailed: false })
    expect(md).toContain("### get_current_time → completed")
    expect(md).not.toContain("Input: {}")
    expect(md).not.toContain('"iso"')
    expect(md).toContain("### Assistant")
  })

  it("includes a metadata block with duration when timing is present", () => {
    const events = [
      {
        position: 0,
        source: "disk",
        receivedAt: 0,
        event: {
          type: "turn.started",
          data: { turnId: "turn_0" },
          meta: { at: "2026-07-11T00:00:00.000Z" },
        },
      },
      {
        position: 1,
        source: "disk",
        receivedAt: 0,
        event: {
          type: "turn.completed",
          data: { turnId: "turn_0" },
          meta: { at: "2026-07-11T00:00:46.000Z" },
        },
      },
    ] as unknown as StoredEvent[]
    const [timed] = groupTurns(messages, events)
    const md = turnToMarkdown(timed, { detailed: true })
    expect(md).toContain("## Metadata")
    expect(md).toContain("Duration: 46s")
    expect(md.indexOf("## Metadata")).toBeLessThan(md.indexOf("## Input"))
  })

  it("labels an errored tool with its error", () => {
    const [t] = groupTurns([
      {
        id: "a2",
        role: "assistant",
        parts: [
          {
            type: "dynamic-tool",
            toolCallId: "t2",
            toolName: "sanity_add",
            state: "output-error",
            input: { field: "x" },
            errorText: "field_not_allowed",
          },
        ],
      },
    ])
    const md = turnToMarkdown(t, { detailed: true })
    expect(md).toContain("### sanity_add → error")
    expect(md).toContain("Output: field_not_allowed")
  })
})
