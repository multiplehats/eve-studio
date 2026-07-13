import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import type { ReactNode } from "react"

import { isNearBottom } from "@/lib/scroll-follow"

export function TranscriptViewport({
  children,
  contentVersion,
  sessionId,
}: {
  children: ReactNode
  contentVersion: string | number
  sessionId: string
}) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const previousSessionIdRef = useRef(sessionId)
  const [following, setFollowing] = useState(true)
  const [hasUnseenContent, setHasUnseenContent] = useState(false)

  const scrollToLatest = useCallback(
    (behavior: ScrollBehavior = "auto"): void => {
      const viewport = viewportRef.current
      if (!viewport) return
      const reduceMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)"
      ).matches
      viewport.scrollTo({
        top: viewport.scrollHeight,
        behavior: reduceMotion ? "auto" : behavior,
      })
    },
    []
  )

  useLayoutEffect(() => {
    if (previousSessionIdRef.current === sessionId) return
    previousSessionIdRef.current = sessionId
    setFollowing(true)
    setHasUnseenContent(false)
    scrollToLatest()
  }, [scrollToLatest, sessionId])

  useEffect(() => {
    if (following) {
      scrollToLatest()
      setHasUnseenContent(false)
    } else {
      setHasUnseenContent(true)
    }
  }, [contentVersion, following, scrollToLatest])

  useEffect(() => {
    const content = contentRef.current
    if (!content || typeof ResizeObserver === "undefined") return

    let previousHeight = content.getBoundingClientRect().height
    const observer = new ResizeObserver((entries) => {
      const entry = entries.find((candidate) => candidate.target === content)
      const nextHeight = entry?.contentRect.height ?? previousHeight
      const grew = nextHeight > previousHeight
      previousHeight = nextHeight
      if (!grew) return

      if (following) {
        scrollToLatest()
        setHasUnseenContent(false)
      } else {
        setHasUnseenContent(true)
      }
    })
    observer.observe(content)
    return () => observer.disconnect()
  }, [following, scrollToLatest])

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
        <div ref={contentRef} data-testid="transcript-content">
          {children}
        </div>
      </div>
      {hasUnseenContent && (
        <button
          type="button"
          className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border bg-background px-3 py-1.5 text-xs font-medium shadow-sm transition-colors hover:bg-muted"
          onClick={() => {
            setFollowing(true)
            setHasUnseenContent(false)
            scrollToLatest("smooth")
          }}
        >
          Jump to latest
        </button>
      )}
    </div>
  )
}
