import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import type { SessionSummary } from "eve-studio"
import { SessionBanners } from "./session-banners"

afterEach(cleanup)

function summary(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    sessionId: "s1",
    agent: "a",
    project: { name: "p", root: "/r" },
    processInstanceId: "i",
    processKind: "unknown",
    group: "g",
    eveVersion: "0.22.4",
    status: "waiting",
    usage: { inputTokens: 0, outputTokens: 0, costUsd: 0, steps: 0 },
    eventCount: 0,
    maxPosition: 0,
    evictedBelow: 0,
    updatedAt: 0,
    ...overrides,
  }
}

describe("SessionBanners", () => {
  it("is empty for a healthy session", () => {
    const { container } = render(
      <SessionBanners summary={summary()} studioEveVersion="0.22.4" />
    )
    expect(container.innerHTML).toBe("")
  })
  it("warns on version mismatch, gap degradation, eviction, and skipped projection events", () => {
    render(
      <SessionBanners
        summary={summary({
          eveVersion: "0.23.0",
          degraded: "gap",
          evictedBelow: 7,
        })}
        diagnostics={[
          { position: 8, eventType: "message.appended", message: "bad delta" },
          { position: 9, eventType: "step.completed", message: "kaput" },
        ]}
        diagnosticCount={7}
        studioEveVersion="0.22.4"
      />
    )
    expect(screen.getByText(/eve 0\.23\.0/)).toBeTruthy()
    expect(screen.getByText(/never arrived/)).toBeTruthy()
    expect(screen.getByText(/position 7/)).toBeTruthy()
    expect(screen.getByText(/skipped 7 events/)).toBeTruthy()
    expect(screen.getByText(/step\.completed at 9.*kaput/)).toBeTruthy()
  })
  it("stays quiet about versions when either side is unknown", () => {
    const { container } = render(
      <SessionBanners
        summary={summary({ eveVersion: undefined })}
        studioEveVersion="0.22.4"
      />
    )
    expect(container.innerHTML).toBe("")
  })
})
