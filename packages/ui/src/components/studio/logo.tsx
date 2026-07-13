import { cn } from "@/lib/utils"

export function Logo({ className }: { className?: string }) {
  return (
    <img
      src="/app-icon.png"
      alt=""
      aria-hidden="true"
      className={cn("size-7 shrink-0 object-cover", className)}
    />
  )
}
