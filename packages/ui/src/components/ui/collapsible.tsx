import { Collapsible as BaseCollapsible } from "@base-ui/react/collapsible"
import type { ComponentProps } from "react"

// shadcn-shaped Collapsible over Base UI (this project is base-lyra / Base UI,
// not Radix). Exposes the Collapsible / CollapsibleTrigger / CollapsibleContent
// names the vendored AI Elements components import. Content defaults to
// keepMounted so collapsed panels stay in the DOM (matches the old <details>
// behavior the message canvas relied on, and keeps replay content searchable).
export const Collapsible = BaseCollapsible.Root
export const CollapsibleTrigger = BaseCollapsible.Trigger

export function CollapsibleContent({
  keepMounted = true,
  ...props
}: ComponentProps<typeof BaseCollapsible.Panel>) {
  return <BaseCollapsible.Panel keepMounted={keepMounted} {...props} />
}
