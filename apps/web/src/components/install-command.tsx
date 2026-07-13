import { useState } from "react"

const COMMANDS = {
  npm: "npx eve-studio",
  pnpm: "pnpm dlx eve-studio",
  yarn: "yarn dlx eve-studio",
  bun: "bunx eve-studio",
} as const

type Manager = keyof typeof COMMANDS

export function InstallCommand() {
  const [manager, setManager] = useState<Manager>("npm")
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(COMMANDS[manager])
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      // Clipboard unavailable (e.g. insecure context): leave the command selectable.
    }
  }

  return (
    <div className="border-hairline bg-surface w-full max-w-md overflow-hidden rounded-lg border text-left">
      <div className="border-hairline flex items-center gap-1 border-b px-2 py-1.5">
        <span className="bg-surface-2 text-faint mr-1 flex size-6 items-center justify-center rounded-md">
          <TerminalIcon />
        </span>
        <div
          role="group"
          aria-label="Package manager"
          className="flex items-center gap-0.5"
        >
          {(Object.keys(COMMANDS) as Array<Manager>).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={manager === m}
              onClick={() => setManager(m)}
              className={`rounded-full px-2.5 py-1 font-mono text-[12px] transition-colors ${
                manager === m
                  ? "border-hairline bg-surface-2 border text-foreground"
                  : "text-faint border border-transparent hover:text-muted"
              }`}
            >
              {m}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={copy}
          aria-label={copied ? "Copied" : "Copy command"}
          className="text-faint hover:bg-surface-2 ml-auto flex size-7 items-center justify-center rounded-md transition-colors hover:text-foreground"
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
        </button>
        <span role="status" aria-live="polite" className="sr-only">
          {copied ? "Command copied" : ""}
        </span>
      </div>
      <div className="px-4 py-3.5">
        <code className="flex items-baseline gap-2 font-mono text-[13.5px] text-foreground">
          <span aria-hidden="true" className="text-faint select-none">
            $
          </span>
          {COMMANDS[manager]}
        </code>
      </div>
    </div>
  )
}

function TerminalIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M3 5l3 3-3 3M8 11h5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function CopyIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <rect
        x="5.5"
        y="5.5"
        width="8"
        height="8"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.25"
      />
      <path
        d="M10.5 5.5v-2a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 3.5v5A1.5 1.5 0 0 0 4 10h1.5"
        stroke="currentColor"
        strokeWidth="1.25"
      />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M3 8.5L6.5 12L13 4.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
