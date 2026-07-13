# @eve-studio/extension

Capture extension for [eve-studio](https://github.com/multiplehats/eve-studio).
It forwards local eve session events to the Studio collector so the browser can
show messages, tool calls, steps, status, and usage while an agent runs.

Most people do not need to install this package by hand. Run `npx eve-studio`
from an eve project and accept the mount prompt.

## Manual setup

Install the extension in your agent project:

```sh
pnpm add @eve-studio/extension
```

Create `agent/extensions/studio.ts`:

```ts
export { default } from "@eve-studio/extension";
```

Start the collector from the same project:

```sh
npx eve-studio
```

The extension sends events to `http://127.0.0.1:43110` by default. If Studio
uses another port, configure both processes with the same value:

```sh
EVE_STUDIO_PORT=43111 npx eve-studio --port 43111
```

Only decimal ports from `1` to `65535` are accepted.

## Runtime behavior

- Delivery is loopback-only, asynchronous, batched, and best-effort.
- Collector failures never fail an agent turn.
- The queue is bounded while Studio is unavailable.
- Production processes are inert by default. Set `EVE_STUDIO_ENABLED=1` to
  capture deliberately when `NODE_ENV=production` or `VERCEL_ENV=production`.
- `EVE_STUDIO_GROUP` can group related runs, and `EVE_STUDIO_KIND` can label a
  launcher-defined process kind.

The current release supports stable eve versions `>=0.22.3 <0.23.0`.

## Support

- [Repository and documentation](https://github.com/multiplehats/eve-studio)
- [Issue tracker](https://github.com/multiplehats/eve-studio/issues)
- [Security policy](https://github.com/multiplehats/eve-studio/security/policy)

MIT licensed.
