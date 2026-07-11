import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ThemeProvider, useTheme } from "./theme-provider"

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

function ThemeProbe() {
  const { setTheme, theme } = useTheme()
  return (
    <button type="button" onClick={() => setTheme("dark")}>
      {theme}
    </button>
  )
}

describe("ThemeProvider", () => {
  it("persists and applies the selected theme", async () => {
    render(
      <ThemeProvider defaultTheme="system" storageKey="eve-theme">
        <ThemeProbe />
      </ThemeProvider>
    )

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "system" })).toBeTruthy()
    )

    fireEvent.click(screen.getByRole("button", { name: "system" }))

    await waitFor(() => {
      expect(localStorage.getItem("eve-theme")).toBe("dark")
      expect(document.documentElement.classList.contains("dark")).toBe(true)
      expect(document.documentElement.classList.contains("light")).toBe(false)
      expect(document.documentElement.style.colorScheme).toBe("dark")
    })
  })
})
