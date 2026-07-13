# @eve-studio/web

Marketing splash page for eve-studio: a single full-height hero with the
install command, built with TanStack Start + Nitro.

Run these commands from the repository root with Node.js 24 or newer and pnpm
10.33.4.

## Develop

```sh
pnpm --filter @eve-studio/web dev
```

Serves on `http://localhost:43130` (43110/43120 belong to the Studio
collector and UI).

## Build

```sh
pnpm --filter @eve-studio/web build
```

Locally this produces a Node server build in `.output/`. On Vercel
(`VERCEL=1`) the Nitro preset switches to `vercel` and emits the Build
Output API structure in `.vercel/output/`.

## Deploy on Vercel

Create a Vercel project with:

- **Root Directory**: `apps/web`
- **Build Command**: `pnpm build`
- **Framework Preset**: Other (output is auto-detected from `.vercel/output`)

No `vercel.json` is required.
