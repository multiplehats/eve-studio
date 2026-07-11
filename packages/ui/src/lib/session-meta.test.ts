import { describe, expect, it } from "vitest"
import type { SessionSummary } from "eve-studio"
import { formatTokens, groupByProject, shortSessionId, timeAgo } from "./session-meta"

function summary(sessionId: string, project: string, updatedAt: number): SessionSummary {
  return {
    sessionId, agent: "a", project: { name: project, root: "/r" },
    processInstanceId: "i", processKind: "unknown", group: "g",
    status: "working", usage: { inputTokens: 0, outputTokens: 0, costUsd: 0, steps: 0 },
    eventCount: 0, maxPosition: 0, evictedBelow: 0, updatedAt,
  }
}

describe("groupByProject", () => {
  it("groups by project name, newest session first, newest project group first", () => {
    const groups = groupByProject([
      summary("old-a", "alpha", 10), summary("new-b", "beta", 40),
      summary("new-a", "alpha", 30), summary("old-b", "beta", 20),
    ])
    expect(groups.map(([name]) => name)).toEqual(["beta", "alpha"])
    expect(groups[0][1].map((s) => s.sessionId)).toEqual(["new-b", "old-b"])
    expect(groups[1][1].map((s) => s.sessionId)).toEqual(["new-a", "old-a"])
  })
  it("names blank projects", () => {
    expect(groupByProject([summary("s", "", 1)])[0][0]).toBe("(unknown project)")
  })
})

describe("formatters", () => {
  it("shortSessionId keeps short ids and elides long ones to a tail", () => {
    expect(shortSessionId("abc")).toBe("abc")
    expect(shortSessionId("wrun_01KX5Z8EX40R4X8BMR4Z26X5Q9")).toBe("…26X5Q9")
  })
  it("formatTokens humanizes counts", () => {
    expect(formatTokens(183)).toBe("183")
    expect(formatTokens(1_234)).toBe("1.2k")
    expect(formatTokens(45_600)).toBe("46k")
    expect(formatTokens(2_500_000)).toBe("2.5M")
  })
  it("timeAgo is deterministic given now", () => {
    expect(timeAgo(1_000, 5_000)).toBe("just now")
    expect(timeAgo(0, 59_000)).toBe("59s ago")
    expect(timeAgo(0, 90_000)).toBe("2m ago")
    expect(timeAgo(0, 3 * 3_600_000)).toBe("3h ago")
    expect(timeAgo(0, 49 * 3_600_000)).toBe("2d ago")
  })
})
