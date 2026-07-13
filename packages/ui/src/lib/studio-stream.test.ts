import { describe, expect, it, vi } from "vitest"
import { QueryClient } from "@tanstack/react-query"
import type { SessionSummary } from "eve-studio"
import {
  applyRegistryUpdate,
  applySessionUpdate,
  createPerKeyThrottle,
} from "./studio-stream"

function summary(sessionId: string, updatedAt = 1): SessionSummary {
  return {
    sessionId,
    agent: "a",
    project: { name: "p", root: "/r" },
    processInstanceId: "i",
    processKind: "unknown",
    group: "g",
    status: "working",
    usage: { inputTokens: 0, outputTokens: 0, costUsd: 0, steps: 0 },
    eventCount: 0,
    maxPosition: 0,
    evictedBelow: 0,
    updatedAt,
  }
}

describe("applySessionUpdate", () => {
  it("appends a session it has never seen (and tolerates undefined)", () => {
    const next = applySessionUpdate(undefined, summary("s1"))
    expect(next.map((s) => s.sessionId)).toEqual(["s1"])
  })
  it("replaces an existing session in place without mutating the input", () => {
    const prev = [summary("s1", 1), summary("s2", 1)]
    const next = applySessionUpdate(prev, summary("s2", 99))
    expect(next.map((s) => s.updatedAt)).toEqual([1, 99])
    expect(prev[1].updatedAt).toBe(1) // input untouched
    expect(next).not.toBe(prev)
  })
})

describe("createPerKeyThrottle", () => {
  it("coalesces bursts per key and fires once per window", () => {
    vi.useFakeTimers()
    const fired: string[] = []
    const t = createPerKeyThrottle(500, (k) => fired.push(k))
    t.trigger("a")
    t.trigger("a")
    t.trigger("b")
    vi.advanceTimersByTime(499)
    expect(fired).toEqual([])
    vi.advanceTimersByTime(1)
    expect(fired.sort()).toEqual(["a", "b"])
    t.trigger("a") // window reopened after firing
    vi.advanceTimersByTime(500)
    expect(fired.filter((k) => k === "a")).toHaveLength(2)
    vi.useRealTimers()
  })
  it("dispose cancels pending timers", () => {
    vi.useFakeTimers()
    const fired: string[] = []
    const t = createPerKeyThrottle(500, (k) => fired.push(k))
    t.trigger("a")
    t.dispose()
    vi.advanceTimersByTime(1_000)
    expect(fired).toEqual([])
    vi.useRealTimers()
  })
})

describe("applyRegistryUpdate", () => {
  it("merges session summaries and refreshes the matching detail", () => {
    const client = new QueryClient()
    const refresh = vi.fn()
    client.setQueryData(["sessions"], [summary("s1", 1)])

    applyRegistryUpdate(
      client,
      { kind: "session", session: summary("s1", 99) },
      refresh
    )

    expect(
      client.getQueryData<SessionSummary[]>(["sessions"])?.[0].updatedAt
    ).toBe(99)
    expect(refresh).toHaveBeenCalledWith("s1")
  })

  it("refreshes event details without requiring raw event data", () => {
    const client = new QueryClient()
    const refresh = vi.fn()

    applyRegistryUpdate(
      client,
      { kind: "event", sessionId: "s1", position: 4 },
      refresh
    )

    expect(refresh).toHaveBeenCalledWith("s1")
  })

  it("removes an evicted session from list and detail caches", () => {
    const client = new QueryClient()
    const refresh = vi.fn()
    client.setQueryData(["sessions"], [summary("s1"), summary("s2")])
    client.setQueryData(["session", "s1"], { summary: summary("s1") })

    applyRegistryUpdate(
      client,
      { kind: "session-removed", sessionId: "s1" },
      refresh
    )

    expect(
      client
        .getQueryData<SessionSummary[]>(["sessions"])
        ?.map((s) => s.sessionId)
    ).toEqual(["s2"])
    expect(client.getQueryState(["session", "s1"])).toBeUndefined()
    expect(refresh).not.toHaveBeenCalled()
  })
})
