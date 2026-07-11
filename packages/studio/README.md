# eve-studio

Zero-config observability for [Eve](https://eve.dev) agents. Run it from your
agent project (or point it at one) and it captures live session events
(messages, steps, tool calls, usage) into an in-memory registry served over
HTTP, no setup beyond mounting one extension.

## Usage

```sh
npx eve-studio
```

Resolves the Eve project in the current directory (or prompts if there are
several), checks the installed `eve` version, offers to mount the Studio
capture extension if it isn't mounted yet, then starts the server.

## Flags

| Flag          | Default | Description                                                                 |
| ------------- | ------- | ---------------------------------------------------------------------------- |
| `--port`      | `43110` | Port to listen on. Pair with `EVE_STUDIO_PORT` (see below) if you change it. |
| `--project`   | (auto)  | Path to the Eve agent project to watch, skipping auto-detection.             |
| `--scan-disk` | off     | Also ingest historical sessions from `.workflow-data` on startup.            |
| `--yes`       | off     | Auto-confirm the extension mount prompt (useful in CI/non-interactive runs). |

## The `EVE_STUDIO_PORT` pairing rule

`eve-studio` never silently picks a different port if `--port` is taken: it
exits with an error instead. If you must run on a non-default port, set the
**same** port on both sides: pass `--port <n>` to `eve-studio` **and** set
`EVE_STUDIO_PORT=<n>` in the agent's environment, so the mounted extension
forwards events to the port `eve-studio` is actually listening on. Mismatched
ports mean the extension forwards into the void.

## What you get today

The CLI starts the capture server and prints where to find the raw session
snapshot (`GET /api/sessions`) and the live event stream. See "Browser UI"
below for the SPA that ships alongside it.

## Browser UI

When `dist/ui/_shell.html` exists (produced by the root `pnpm build:studio`),
the collector serves the SPA at `http://127.0.0.1:43110` alongside the API:
same process, same port, no CORS. Without it, eve-studio runs API-only and says
so at startup. `/health` reports `studioVersion` and `eveVersion` (the eve this
package bundles for reduction); the UI banners any session whose agent-side eve
differs.
