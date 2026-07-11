import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { ReadOnlyComposer } from "./composer"

afterEach(cleanup)

describe("ReadOnlyComposer", () => {
  it("is fully disabled — Studio has no channel back into an agent", () => {
    render(<ReadOnlyComposer agent="demo-agent" />)
    const textarea = screen.getByPlaceholderText("Message demo-agent…") as HTMLTextAreaElement
    expect(textarea.disabled).toBe(true)
    const send = screen.getByLabelText("Send (disabled — view-only)") as HTMLButtonElement
    expect(send.disabled).toBe(true)
  })
  it("falls back to a generic placeholder when the agent name is empty", () => {
    render(<ReadOnlyComposer agent="" />)
    expect(screen.getByPlaceholderText("Message your agent…")).toBeTruthy()
  })
})
