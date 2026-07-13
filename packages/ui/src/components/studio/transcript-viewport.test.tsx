import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { TranscriptViewport } from "./transcript-viewport"

afterEach(cleanup)

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn(() => ({ matches: false })),
  })
  Object.defineProperty(HTMLElement.prototype, "scrollTo", {
    configurable: true,
    value: vi.fn(),
  })
})

describe("TranscriptViewport", () => {
  it("pauses away from the bottom and lets the viewer jump to new content", () => {
    const scrollTo = vi.fn()
    const { rerender } = render(
      <TranscriptViewport contentVersion={1}>
        <p>first</p>
      </TranscriptViewport>
    )
    const viewport = screen.getByTestId("transcript-scroll")
    Object.defineProperties(viewport, {
      scrollTop: { configurable: true, value: 100, writable: true },
      clientHeight: { configurable: true, value: 400 },
      scrollHeight: { configurable: true, value: 1_000 },
      scrollTo: { configurable: true, value: scrollTo },
    })
    fireEvent.scroll(viewport)

    rerender(
      <TranscriptViewport contentVersion={2}>
        <p>second</p>
      </TranscriptViewport>
    )

    const jump = screen.getByRole("button", { name: "Jump to latest" })
    expect(scrollTo).not.toHaveBeenCalled()
    fireEvent.click(jump)
    expect(scrollTo).toHaveBeenCalledWith({ top: 1_000, behavior: "smooth" })
    expect(screen.queryByRole("button", { name: "Jump to latest" })).toBeNull()
  })
})
