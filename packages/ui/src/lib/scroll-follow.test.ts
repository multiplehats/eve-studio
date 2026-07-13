import { describe, expect, it } from "vitest"
import { isNearBottom } from "./scroll-follow"

describe("isNearBottom", () => {
  it("treats viewports within the threshold as following", () => {
    expect(
      isNearBottom({ scrollTop: 436, clientHeight: 500, scrollHeight: 1000 })
    ).toBe(true)
    expect(
      isNearBottom({ scrollTop: 435, clientHeight: 500, scrollHeight: 1000 })
    ).toBe(false)
  })

  it("handles short and temporarily over-scrolled content", () => {
    expect(
      isNearBottom({ scrollTop: 0, clientHeight: 500, scrollHeight: 300 })
    ).toBe(true)
    expect(
      isNearBottom({ scrollTop: 510, clientHeight: 500, scrollHeight: 1000 })
    ).toBe(true)
  })
})
