import { describe, expect, it } from "vitest"
import type { EveMessage, StoredEvent } from "eve-studio"
import { formatDuration, groupTurns } from "./session-turns"

// Raw events carry the wire timestamp on `event.meta.at`, which isn't in the
// StoredEvent type — build loosely and cast.
function ev(type: string, turnId: string, at: string): StoredEvent {
  return { position: 0, source: "disk", receivedAt: 0, event: { type, data: { turnId }, meta: { at } } } as unknown as StoredEvent
}

describe("groupTurns", () => {
  it("pairs each user message with the following assistant message and counts tools/steps", () => {
    const turns = groupTurns([
      { id: "u1", role: "user", parts: [{ type: "text", text: "hi" }] },
      {
        id: "a1",
        role: "assistant",
        metadata: { turnId: "turn_0" },
        parts: [
          { type: "dynamic-tool", toolCallId: "t", toolName: "x", state: "output-available", input: {}, output: 1, stepIndex: 0 },
          { type: "text", text: "done", state: "done", stepIndex: 1 },
        ],
      },
      { id: "u2", role: "user", parts: [{ type: "text", text: "again" }] },
      { id: "a2", role: "assistant", parts: [{ type: "text", text: "ok", state: "done" }] },
    ] satisfies EveMessage[])

    expect(turns).toHaveLength(2)
    expect(turns[0].id).toBe("turn_0")
    expect(turns[0].user?.id).toBe("u1")
    expect(turns[0].assistant?.id).toBe("a1")
    expect(turns[0].toolCount).toBe(1)
    expect(turns[0].stepCount).toBe(2)
    expect(turns[1].id).toBe("turn-1") // no turnId → index fallback
    expect(turns[1].toolCount).toBe(0)
  })

  it("handles an assistant message with no preceding user", () => {
    const turns = groupTurns([
      { id: "a", role: "assistant", parts: [{ type: "text", text: "hi", state: "done" }] },
    ] satisfies EveMessage[])
    expect(turns).toHaveLength(1)
    expect(turns[0].user).toBeUndefined()
    expect(turns[0].id).toBe("turn-0")
  })

  it("attaches per-turn duration from event meta.at, joined by turnId", () => {
    const messages: EveMessage[] = [
      { id: "u", role: "user", parts: [{ type: "text", text: "hi" }] },
      { id: "a", role: "assistant", metadata: { turnId: "turn_0" }, parts: [{ type: "text", text: "ok", state: "done" }] },
    ]
    const events = [
      ev("turn.started", "turn_0", "2026-07-11T00:00:00.000Z"),
      ev("step.completed", "turn_0", "2026-07-11T00:00:01.000Z"),
      ev("turn.completed", "turn_0", "2026-07-11T00:00:03.500Z"),
    ]
    const [turn] = groupTurns(messages, events)
    expect(turn.durationMs).toBe(3500)
  })

  it("falls back to min/max event time when turn.completed is absent", () => {
    const messages: EveMessage[] = [
      { id: "a", role: "assistant", metadata: { turnId: "turn_0" }, parts: [{ type: "text", text: "x", state: "done" }] },
    ]
    const events = [
      ev("turn.started", "turn_0", "2026-07-11T00:00:00.000Z"),
      ev("step.completed", "turn_0", "2026-07-11T00:00:02.000Z"),
    ]
    const [turn] = groupTurns(messages, events)
    expect(turn.durationMs).toBe(2000)
  })
})

describe("formatDuration", () => {
  it("formats sub-second, seconds, and minutes", () => {
    expect(formatDuration(820)).toBe("820ms")
    expect(formatDuration(3043)).toBe("3s")
    expect(formatDuration(46000)).toBe("46s")
    expect(formatDuration(135000)).toBe("2m 15s")
    expect(formatDuration(120000)).toBe("2m")
  })
})
