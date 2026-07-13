import { createFileRoute } from "@tanstack/react-router"

import { EmptyState } from "@/components/studio/empty-state"

export const Route = createFileRoute("/")({ component: EmptyState })
