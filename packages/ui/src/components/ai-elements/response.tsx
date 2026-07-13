import { cn } from "@/lib/utils"
import type { ComponentProps } from "react"
import { memo } from "react"
import { Streamdown } from "streamdown"

// Vendored from AI Elements (elements.ai-sdk.dev): the markdown renderer ships
// as `MessageResponse` inside the `message` component; there is no standalone
// `response` slug. This is that renderer, a thin Streamdown wrapper, so assistant
// text and reasoning render real markdown (GFM tables, code, lists) instead of
// raw whitespace-pre text.
export type ResponseProps = ComponentProps<typeof Streamdown>

export const Response = memo(function Response({
  className,
  ...props
}: ResponseProps) {
  return (
    <Streamdown
      className={cn(
        "size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
        className
      )}
      {...props}
    />
  )
})
