import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import type { EveMessage } from "eve-studio"
import { MessageList } from "./message-list"

afterEach(cleanup)

const MESSAGES: EveMessage[] = [
  { id: "u1", role: "user", parts: [{ type: "text", text: "ping one" }] },
  {
    id: "a1", role: "assistant", metadata: { status: "complete" },
    parts: [
      { type: "step-start" },
      { type: "reasoning", text: "thinking hard", state: "done" },
      {
        type: "dynamic-tool", toolCallId: "t1", toolName: "run_query",
        state: "output-error", input: { q: 1 }, errorText: "boom",
      },
      { type: "text", text: "MOCK[1]: ping one" },
    ],
  },
]

describe("MessageList", () => {
  it("renders user and assistant text parts", () => {
    render(<MessageList messages={MESSAGES} />)
    expect(screen.getByText("ping one")).toBeTruthy()
    expect(screen.getByText("MOCK[1]: ping one")).toBeTruthy()
  })
  it("renders tool calls with their lifecycle state and error payload", () => {
    render(<MessageList messages={MESSAGES} />)
    expect(screen.getByText("run_query")).toBeTruthy()
    expect(screen.getByText("error")).toBeTruthy()
    expect(screen.getByText("boom")).toBeTruthy()
  })
  it("tucks reasoning behind a disclosure", () => {
    render(<MessageList messages={MESSAGES} />)
    expect(screen.getByText("Reasoning")).toBeTruthy()
    expect(screen.getByText("thinking hard")).toBeTruthy()
  })
})
