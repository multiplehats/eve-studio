import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { TranscriptViewport } from "./transcript-viewport"

let resizeCallback: ResizeObserverCallback | undefined

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

beforeEach(() => {
  resizeCallback = undefined
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: ResizeObserverCallback) {
        resizeCallback = callback
      }

      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
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
      <TranscriptViewport sessionId="session-one" contentVersion={1}>
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
      <TranscriptViewport sessionId="session-one" contentVersion={2}>
        <p>second</p>
      </TranscriptViewport>
    )

    const jump = screen.getByRole("button", { name: "Jump to latest" })
    expect(scrollTo).not.toHaveBeenCalled()
    fireEvent.click(jump)
    expect(scrollTo).toHaveBeenCalledWith({ top: 1_000, behavior: "smooth" })
    expect(screen.queryByRole("button", { name: "Jump to latest" })).toBeNull()
  })

  it("follows asynchronous child height growth without a content update", () => {
    render(
      <TranscriptViewport sessionId="session-one" contentVersion={1}>
        <p>streamed markdown</p>
      </TranscriptViewport>
    )
    const viewport = screen.getByTestId("transcript-scroll")
    const content = screen.getByTestId("transcript-content")
    const scrollTo = vi.fn()
    Object.defineProperties(viewport, {
      scrollHeight: { configurable: true, value: 1_200 },
      scrollTo: { configurable: true, value: scrollTo },
    })

    expect(resizeCallback).toBeTypeOf("function")
    act(() => {
      resizeCallback?.(
        [
          {
            target: content,
            contentRect: { height: 600 },
          } as unknown as ResizeObserverEntry,
        ],
        {} as ResizeObserver
      )
    })

    expect(scrollTo).toHaveBeenCalledWith({
      top: 1_200,
      behavior: "smooth",
    })
  })

  it("resets paused follow state when navigating to another session", () => {
    const { rerender } = render(
      <TranscriptViewport sessionId="session-one" contentVersion={1}>
        <p>first session</p>
      </TranscriptViewport>
    )
    const viewport = screen.getByTestId("transcript-scroll")
    const scrollTo = vi.fn()
    Object.defineProperties(viewport, {
      scrollTop: { configurable: true, value: 100, writable: true },
      clientHeight: { configurable: true, value: 400 },
      scrollHeight: { configurable: true, value: 1_000 },
      scrollTo: { configurable: true, value: scrollTo },
    })
    fireEvent.scroll(viewport)
    expect(screen.getByRole("button", { name: "Jump to latest" })).toBeTruthy()
    scrollTo.mockClear()

    rerender(
      <TranscriptViewport sessionId="session-two" contentVersion={1}>
        <p>second session</p>
      </TranscriptViewport>
    )

    expect(screen.queryByRole("button", { name: "Jump to latest" })).toBeNull()
    expect(scrollTo).toHaveBeenCalledWith({ top: 1_000, behavior: "smooth" })
  })
})
