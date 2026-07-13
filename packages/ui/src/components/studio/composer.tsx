import { Card } from "@/components/ui/card"
import { Field, FieldLabel } from "@/components/ui/field"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowUp02Icon } from "@hugeicons/core-free-icons"

// The app-shell-17 composer surface, kept for the familiar chat-canvas shape
// but permanently disabled: the collector observes agent sessions and has no
// channel to send anything back into one.
export function ReadOnlyComposer({ agent }: { agent?: string }) {
  return (
    <div className="mx-auto w-full max-w-3xl">
      <Field>
        <FieldLabel htmlFor="composer-input" className="sr-only">
          Message (view-only)
        </FieldLabel>

        <Card className="p-0">
          <InputGroup className="border-0 bg-transparent shadow-none">
            <InputGroupTextarea
              id="composer-input"
              disabled
              placeholder={`Message ${agent || "your agent"}…`}
              rows={1}
              aria-label="Message (view-only)"
              className="max-h-44 min-h-12"
            />

            <InputGroupAddon
              align="block-end"
              className="justify-between gap-2"
            >
              <span className="px-1 text-xs text-muted-foreground">
                View-only: Studio observes this session and can’t reply.
              </span>
              <InputGroupButton
                type="button"
                variant="default"
                size="icon-sm"
                disabled
                aria-label="Send (disabled, view-only)"
                className="rounded-full"
              >
                <HugeiconsIcon
                  icon={ArrowUp02Icon}
                  strokeWidth={2}
                  aria-hidden="true"
                />
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        </Card>
      </Field>
    </div>
  )
}
