import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import type { SessionSummary } from "eve-studio"
import { SessionBanners } from "./session-banners"

afterEach(cleanup)

function summary(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    sessionId: "s1", agent: "a", project: { name: "p", root: "/r" },
    processInstanceId: "i", processKind: "unknown", group: "g", eveVersion: "0.22.4",
    status: "waiting", usage: { inputTokens: 0, outputTokens: 0, costUsd: 0, steps: 0 },
    eventCount: 0, maxPosition: 0, evictedBelow: 0, updatedAt: 0,
    ...overrides,
  }
}

describe("SessionBanners", () => {
  it("is empty for a healthy session", () => {
    const { container } = render(<SessionBanners summary={summary()} studioEveVersion="0.22.4" />)
    expect(container.innerHTML).toBe("")
  })
  it("warns on version mismatch, gap degradation, eviction, and reducer errors", () => {
    render(
      <SessionBanners
        summary={summary({ eveVersion: "0.23.0", degraded: "gap", evictedBelow: 7 })}
        reducerError="kaput"
        studioEveVersion="0.22.4"
      />,
    )
    expect(screen.getByText(/eve 0\.23\.0/)).toBeTruthy()
    expect(screen.getByText(/never arrived/)).toBeTruthy()
    expect(screen.getByText(/position 7/)).toBeTruthy()
    expect(screen.getByText(/kaput/)).toBeTruthy()
  })
  it("stays quiet about versions when either side is unknown", () => {
    const { container } = render(<SessionBanners summary={summary({ eveVersion: undefined })} studioEveVersion="0.22.4" />)
    expect(container.innerHTML).toBe("")
  })
})
