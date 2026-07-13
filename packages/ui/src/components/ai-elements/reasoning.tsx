import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"
import { AiBrain01Icon, ArrowDown01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useControllableState } from "@radix-ui/react-use-controllable-state"
import type { ComponentProps, ReactNode } from "react"
import { createContext, memo, useContext, useEffect, useState } from "react"
import { Response } from "./response"

// Vendored from AI Elements (elements.ai-sdk.dev) `reasoning`, adapted to this
// project's stack: Base UI collapsible, hugeicons, Streamdown-via-Response for
// the body, and a plain animate-pulse label instead of the motion-based Shimmer
// (avoids pulling motion/react for a single label). Auto-opens while streaming
// and auto-closes shortly after, tracking think-duration.
type ReasoningContextValue = {
  isStreaming: boolean
  isOpen: boolean
  setIsOpen: (open: boolean) => void
  duration: number | undefined
}

const ReasoningContext = createContext<ReasoningContextValue | null>(null)

function useReasoning() {
  const context = useContext(ReasoningContext)
  if (!context) {
    throw new Error("Reasoning components must be used within Reasoning")
  }
  return context
}

export type ReasoningProps = ComponentProps<typeof Collapsible> & {
  isStreaming?: boolean
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  duration?: number
}

const AUTO_CLOSE_DELAY = 1000
const MS_IN_S = 1000

export const Reasoning = memo(function Reasoning({
  className,
  isStreaming = false,
  open,
  defaultOpen = true,
  onOpenChange,
  duration: durationProp,
  children,
  ...props
}: ReasoningProps) {
  const [isOpen, setIsOpen] = useControllableState({
    prop: open,
    defaultProp: defaultOpen,
    onChange: onOpenChange,
  })
  const [duration, setDuration] = useControllableState<number | undefined>({
    prop: durationProp,
    defaultProp: undefined,
  })

  const [hasAutoClosed, setHasAutoClosed] = useState(false)
  const [startTime, setStartTime] = useState<number | null>(null)

  // Track duration when streaming starts and ends.
  useEffect(() => {
    if (isStreaming) {
      if (startTime === null) setStartTime(Date.now())
    } else if (startTime !== null) {
      setDuration(Math.ceil((Date.now() - startTime) / MS_IN_S))
      setStartTime(null)
    }
  }, [isStreaming, startTime, setDuration])

  // Auto-open while streaming, auto-close once shortly after it ends.
  useEffect(() => {
    if (defaultOpen && !isStreaming && isOpen && !hasAutoClosed) {
      const timer = setTimeout(() => {
        setIsOpen(false)
        setHasAutoClosed(true)
      }, AUTO_CLOSE_DELAY)
      return () => clearTimeout(timer)
    }
  }, [isStreaming, isOpen, defaultOpen, setIsOpen, hasAutoClosed])

  return (
    <ReasoningContext.Provider
      value={{ isStreaming, isOpen, setIsOpen, duration }}
    >
      <Collapsible
        className={cn("not-prose", className)}
        onOpenChange={setIsOpen}
        open={isOpen}
        {...props}
      >
        {children}
      </Collapsible>
    </ReasoningContext.Provider>
  )
})

export type ReasoningTriggerProps = ComponentProps<
  typeof CollapsibleTrigger
> & {
  getThinkingMessage?: (isStreaming: boolean, duration?: number) => ReactNode
}

function defaultGetThinkingMessage(isStreaming: boolean, duration?: number) {
  if (isStreaming || duration === 0) {
    return <span className="animate-pulse">Thinking…</span>
  }
  if (duration === undefined) return <span>Reasoning</span>
  return <span>Thought for {duration}s</span>
}

export const ReasoningTrigger = memo(function ReasoningTrigger({
  className,
  children,
  getThinkingMessage = defaultGetThinkingMessage,
  ...props
}: ReasoningTriggerProps) {
  const { isStreaming, isOpen, duration } = useReasoning()
  return (
    <CollapsibleTrigger
      className={cn(
        "flex items-center gap-2 text-xs font-medium text-muted-foreground transition-colors select-none hover:text-foreground",
        className
      )}
      {...props}
    >
      {children ?? (
        <>
          <HugeiconsIcon
            icon={AiBrain01Icon}
            className="size-4"
            strokeWidth={2}
            aria-hidden="true"
          />
          {getThinkingMessage(isStreaming, duration)}
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            className={cn(
              "size-4 transition-transform",
              isOpen ? "rotate-180" : "rotate-0"
            )}
            strokeWidth={2}
            aria-hidden="true"
          />
        </>
      )}
    </CollapsibleTrigger>
  )
})

export type ReasoningContentProps = Omit<
  ComponentProps<typeof CollapsibleContent>,
  "children"
> & { children: string }

export const ReasoningContent = memo(function ReasoningContent({
  className,
  children,
  ...props
}: ReasoningContentProps) {
  return (
    <CollapsibleContent
      className={cn(
        "mt-2 border-l-2 pl-3 text-sm text-muted-foreground",
        className
      )}
      {...props}
    >
      <Response>{children}</Response>
    </CollapsibleContent>
  )
})
