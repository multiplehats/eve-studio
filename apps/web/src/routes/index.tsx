import { createFileRoute } from "@tanstack/react-router"

import { StudioLockup } from "@/components/logo"
import { InstallCommand } from "@/components/install-command"
import { TraceField } from "@/components/trace-field"

export const Route = createFileRoute("/")({
  component: SplashPage,
})

const LINKS = {
  docs: "https://github.com/multiplehats/eve-studio#readme",
  eve: "https://vercel.com/eve",
  github: "https://github.com/multiplehats/eve-studio",
  creator: "https://x.com/itschrisjayden",
}

function SplashPage() {
  return (
    <div className="relative flex min-h-dvh flex-col">
      <TraceField />

      <main className="relative z-10 flex flex-1 flex-col items-center justify-center gap-7 px-6 py-16 text-center">
        <div
          className="rise"
          style={{ "--rise-delay": "0s" } as React.CSSProperties}
        >
          <StudioLockup markClassName="h-[19px]" wordClassName="text-[16px]" />
        </div>

        <p
          className="rise text-[11px] uppercase tracking-[0.22em] text-faint"
          style={{ "--rise-delay": "0.08s" } as React.CSSProperties}
        >
          Observability for eve agents
        </p>

        <div
          className="rise"
          style={{ "--rise-delay": "0.18s" } as React.CSSProperties}
        >
          <h1
            className="shimmer shimmer-duration-2500 max-w-4xl text-balance text-[clamp(2.625rem,8.5vw,4.75rem)] font-medium leading-[1.04] tracking-[-0.04em] text-[#8a8a8a]"
            style={{ "--shimmer-color": "#ffffff" } as React.CSSProperties}
          >
            Watch your agent work.
          </h1>
        </div>

        <p
          className="rise max-w-[34rem] text-pretty text-[15px] leading-relaxed text-muted sm:text-base"
          style={{ "--rise-delay": "0.28s" } as React.CSSProperties}
        >
          One command mounts a live workspace beside your eve project. Sessions,
          messages, tool calls, and usage stream to your browser as your agent
          runs.
        </p>

        <div
          className="rise mt-2 flex w-full flex-col items-center gap-5"
          style={{ "--rise-delay": "0.4s" } as React.CSSProperties}
        >
          <InstallCommand />

          <nav className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[13px] text-faint">
            <FooterLink href={LINKS.docs}>Read the docs</FooterLink>
            <FooterLink href={LINKS.github}>GitHub</FooterLink>
            <FooterLink href={LINKS.eve}>eve</FooterLink>
            <FooterLink href={LINKS.creator}>@itschrisjayden</FooterLink>
          </nav>
        </div>
      </main>

      <footer className="relative z-10 flex h-14 items-center justify-center text-[12px] text-faint">
        MIT License
      </footer>
    </div>
  )
}

function FooterLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="transition-colors hover:text-foreground"
    >
      {children}
      <Arrow />
    </a>
  )
}

function Arrow() {
  return (
    <span aria-hidden="true" className="ml-1 inline-block">
      ↗
    </span>
  )
}
