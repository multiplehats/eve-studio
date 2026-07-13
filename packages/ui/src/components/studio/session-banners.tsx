import type { ProjectionDiagnostic, SessionSummary } from "eve-studio"

interface Banner {
  key: string
  tone: "warn" | "error"
  text: string
}

export function SessionBanners({
  summary,
  diagnostics = [],
  diagnosticCount = diagnostics.length,
  studioEveVersion,
}: {
  summary: SessionSummary
  diagnostics?: readonly ProjectionDiagnostic[]
  diagnosticCount?: number
  studioEveVersion?: string
}) {
  const banners: Banner[] = []
  if (summary.degraded === "epoch-reset") {
    banners.push({
      key: "degraded",
      tone: "warn",
      text: "Hooks were re-registered mid-session (epoch reset) — event ordering after the reset is best-effort.",
    })
  }
  if (summary.degraded === "gap") {
    banners.push({
      key: "degraded",
      tone: "warn",
      text: "Some earlier events never arrived — the conversation resumes from the first captured point.",
    })
  }
  if (summary.evictedBelow > 0) {
    banners.push({
      key: "evicted",
      tone: "warn",
      text: `Raw events before position ${summary.evictedBelow} were evicted under the memory cap (reduced text is kept).`,
    })
  }
  if (diagnostics.length > 0) {
    const latest = diagnostics[diagnostics.length - 1]
    banners.push({
      key: "projection",
      tone: "warn",
      text: `Studio skipped ${diagnosticCount} ${diagnosticCount === 1 ? "event" : "events"} while building this conversation. Latest: ${latest.eventType} at ${latest.position} — ${latest.message}`,
    })
  }
  if (
    studioEveVersion &&
    summary.eveVersion &&
    summary.eveVersion !== studioEveVersion
  ) {
    banners.push({
      key: "version",
      tone: "warn",
      text: `Agent runs eve ${summary.eveVersion}; Studio bundles eve ${studioEveVersion} — the conversation view may miss newer event shapes.`,
    })
  }
  if (banners.length === 0) return null
  return (
    <div className="flex flex-col gap-1 px-4 pt-2">
      {banners.map((b) => (
        <p
          key={b.key}
          role="status"
          className={`rounded-md border px-3 py-1.5 text-xs ${
            b.tone === "error"
              ? "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400"
              : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400"
          }`}
        >
          {b.text}
        </p>
      ))}
    </div>
  )
}
