import { afterEach, describe, expect, it, vi } from "vitest"
import { fetchSession, fetchSessions } from "./studio-api"

afterEach(() => vi.unstubAllGlobals())

describe("studio-api", () => {
  it("unwraps the sessions envelope", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ sessions: [{ sessionId: "s1" }] }), {
            status: 200,
          })
      )
    )
    const sessions = await fetchSessions()
    expect(sessions).toEqual([{ sessionId: "s1" }])
  })
  it("throws on non-ok responses and URL-encodes the session id", async () => {
    const spy = vi.fn(async () => new Response("{}", { status: 404 }))
    vi.stubGlobal("fetch", spy)
    await expect(fetchSession("a/b")).rejects.toThrow("404")
    expect(spy).toHaveBeenCalledWith("/api/sessions/a%2Fb")
  })
})
