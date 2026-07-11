import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ModeToggle } from "./mode-toggle"
import { ThemeProvider } from "./theme-provider"

vi.mock("@tanstack/react-router", () => ({
  ScriptOnce: () => null,
}))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  localStorage.clear()
  document.documentElement.classList.remove("light", "dark")
  document.documentElement.style.colorScheme = ""
})

beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      media: "(prefers-color-scheme: dark)",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
  )
})

describe("ModeToggle", () => {
  it("sets the selected theme from the menu", async () => {
    render(
      <ThemeProvider defaultTheme="system" storageKey="eve-theme">
        <ModeToggle />
      </ThemeProvider>
    )

    fireEvent.click(screen.getByRole("button", { name: "Toggle theme" }))
    fireEvent.click(await screen.findByRole("menuitem", { name: "Dark" }))

    await waitFor(() => {
      expect(localStorage.getItem("eve-theme")).toBe("dark")
      expect(document.documentElement.classList.contains("dark")).toBe(true)
    })
  })
})
