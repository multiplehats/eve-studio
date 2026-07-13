import { useEffect, useRef, useState } from "react"
import type { ReactNode } from "react"

import { isNearBottom } from "@/lib/scroll-follow"

export function TranscriptViewport({
  children,
  contentVersion,
}: {
  children: ReactNode
  contentVersion: string | number
}) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const [following, setFollowing] = useState(true)
  const [hasUnseenContent, setHasUnseenContent] = useState(false)

  function scrollToLatest(): void {
    const viewport = viewportRef.current
    if (!viewport) return
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches
    viewport.scrollTo({
      top: viewport.scrollHeight,
      behavior: reduceMotion ? "auto" : "smooth",
    })
  }

  useEffect(() => {
    if (following) {
      scrollToLatest()
      setHasUnseenContent(false)
    } else {
      setHasUnseenContent(true)
    }
  }, [contentVersion, following])

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={viewportRef}
        data-testid="transcript-scroll"
        className="h-full overflow-y-auto"
        onScroll={(event) => {
          const nearBottom = isNearBottom(event.currentTarget)
          setFollowing(nearBottom)
          if (nearBottom) setHasUnseenContent(false)
        }}
      >
        {children}
      </div>
      {hasUnseenContent && (
        <button
          type="button"
          className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border bg-background px-3 py-1.5 text-xs font-medium shadow-sm transition-colors hover:bg-muted"
          onClick={() => {
            setFollowing(true)
            setHasUnseenContent(false)
            scrollToLatest()
          }}
        >
          Jump to latest
        </button>
      )}
    </div>
  )
}
