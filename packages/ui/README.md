# @eve-studio/ui

Browser UI for [eve-studio](../studio). Private package — it is never published;
its build output ships inside the `eve-studio` package as static assets
(`packages/studio/dist/ui`), served by the collector on port 43110.

## Stack

TanStack Start (SPA mode) + TanStack Query, Tailwind v4 and shadcn.

Data comes from the collector API: `GET /api/sessions`, `GET /api/sessions/<id>`,
`GET /api/stream` (SSE), `GET /health`.

## Development

```bash
pnpm --filter eve-studio build      # once — the dev collector imports its dist
pnpm dev:collector                  # terminal 1: fixture-replay collector on 43110
pnpm dev                            # terminal 2: vite on 43120, /api proxied to 43110
```

Open http://127.0.0.1:43120 — the recorded mock-eval session appears in the
sidebar. No paid API calls: the fixture was recorded once under
`EVE_STUDIO_MOCK=1`.

If you restart the dev collector, reload the page: the vite proxy holds the
dead SSE socket open, so the footer never flips to "Reconnecting…" and the
stream stays silently stale. Served from the real bundle (no proxy),
disconnect detection and auto-reconnect work as designed.

## Production build

`pnpm build` emits `dist/client/` (`_shell.html` + `assets/`). The root
`pnpm build:studio` runs this, builds the studio package, and copies the output
into `packages/studio/dist/ui`. Regression gate: `pnpm smoke:studio` (15 checks).
