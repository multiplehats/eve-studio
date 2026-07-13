import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { SidebarProvider } from "@/components/ui/sidebar"
import { EmptyState } from "./empty-state"

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  })
})

afterEach(cleanup)

describe("EmptyState", () => {
  it("keeps the session sidebar reachable", () => {
    render(
      <SidebarProvider>
        <EmptyState />
      </SidebarProvider>
    )

    expect(
      screen.getByRole("button", { name: "Toggle session sidebar" })
    ).toBeTruthy()
  })
})
