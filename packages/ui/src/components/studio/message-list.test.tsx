import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import type { EveMessage } from "eve-studio"
import { MessageList } from "./message-list"

afterEach(cleanup)

const MESSAGES: EveMessage[] = [
  { id: "u1", role: "user", parts: [{ type: "text", text: "ping one" }] },
  {
    id: "a1",
    role: "assistant",
    metadata: { status: "complete" },
    parts: [
      { type: "step-start" },
      { type: "reasoning", text: "thinking hard", state: "done" },
      {
        type: "dynamic-tool",
        toolCallId: "t1",
        toolName: "run_query",
        state: "output-error",
        input: { q: 1 },
        errorText: "boom",
      },
      { type: "text", text: "MOCK[1]: ping one" },
    ],
  },
]

describe("MessageList", () => {
  it("renders user and assistant text parts", () => {
    render(<MessageList sessionId="session-one" messages={MESSAGES} />)
    expect(screen.getByText("ping one")).toBeTruthy()
    expect(screen.getByText("MOCK[1]: ping one")).toBeTruthy()
  })
  it("renders tool calls with their lifecycle state and error payload", () => {
    render(<MessageList sessionId="session-one" messages={MESSAGES} />)
    expect(screen.getByText("run_query")).toBeTruthy()
    expect(screen.getByText("error")).toBeTruthy()
    expect(screen.getByText("boom")).toBeTruthy()
  })
  it("tucks reasoning behind a disclosure", () => {
    render(<MessageList sessionId="session-one" messages={MESSAGES} />)
    expect(screen.getByText("Reasoning")).toBeTruthy()
    expect(screen.getByText("thinking hard")).toBeTruthy()
  })
  it("keeps an open turn drawer in sync with streamed message updates", () => {
    const initial: EveMessage[] = [
      MESSAGES[0],
      {
        ...MESSAGES[1],
        metadata: { ...MESSAGES[1].metadata, turnId: "turn-live" },
        parts: [{ type: "text", text: "first version" }],
      },
    ]
    const { rerender } = render(
      <MessageList sessionId="session-one" messages={initial} />
    )
    fireEvent.click(
      screen.getByRole("button", { name: /open turn turn-live/i })
    )

    const updated: EveMessage[] = [
      initial[0],
      { ...initial[1], parts: [{ type: "text", text: "second version" }] },
    ]
    rerender(<MessageList sessionId="session-one" messages={updated} />)

    expect(
      within(screen.getByRole("dialog")).getByText(/second version/)
    ).toBeTruthy()
  })

  it("closes an open turn when navigating to another session", () => {
    const firstSession: EveMessage[] = [
      MESSAGES[0],
      {
        ...MESSAGES[1],
        metadata: { ...MESSAGES[1].metadata, turnId: "shared-turn" },
        parts: [{ type: "text", text: "first session answer" }],
      },
    ]
    const secondSession: EveMessage[] = [
      { ...MESSAGES[0], id: "u2", parts: [{ type: "text", text: "second" }] },
      {
        ...MESSAGES[1],
        id: "a2",
        metadata: { ...MESSAGES[1].metadata, turnId: "shared-turn" },
        parts: [{ type: "text", text: "second session answer" }],
      },
    ]
    const { rerender } = render(
      <MessageList sessionId="session-one" messages={firstSession} />
    )
    fireEvent.click(
      screen.getByRole("button", { name: /open turn shared-turn/i })
    )
    expect(screen.getByRole("dialog")).toBeTruthy()

    rerender(<MessageList sessionId="session-two" messages={secondSession} />)

    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("clears a missing open turn so it cannot reopen later", () => {
    const live: EveMessage[] = [
      MESSAGES[0],
      {
        ...MESSAGES[1],
        metadata: { ...MESSAGES[1].metadata, turnId: "turn-live" },
        parts: [{ type: "text", text: "live answer" }],
      },
    ]
    const { rerender } = render(
      <MessageList sessionId="session-one" messages={live} />
    )
    fireEvent.click(
      screen.getByRole("button", { name: /open turn turn-live/i })
    )
    expect(screen.getByRole("dialog")).toBeTruthy()

    rerender(<MessageList sessionId="session-one" messages={[MESSAGES[0]]} />)
    expect(screen.queryByRole("dialog")).toBeNull()

    rerender(<MessageList sessionId="session-one" messages={live} />)
    expect(screen.queryByRole("dialog")).toBeNull()
  })
})
