# Studio reliability implementation plan

> Keep the direct-route fix evidence-led: add the real browser gate first; do not rewrite router configuration unless that gate fails with a trace.

**Goal:** Make live sessions pleasant to inspect and guarantee that a cold `/sessions/<id>` URL hydrates in the shipped bundle.

**Architecture:** TanStack Query remains the cache. SSE updates coalesce detail invalidations. Transcript following is a small state machine around the existing scroll viewport. Playwright exercises the exact packaged UI and collector.

**Stack:** React 19, TanStack Router/Query, Vitest/jsdom, Playwright Chromium.

---

## Task 1: Recover detail queries and session removals

**Files:**

- Modify `packages/ui/src/lib/studio-stream.tsx`
- Modify `packages/ui/src/lib/studio-stream.test.ts`
- Modify `packages/ui/src/lib/studio-queries.ts`

1. Refactor update handling into an exported pure/cache-callback helper so it can be tested without a real `EventSource`.
2. Add failing tests proving `kind: "session"` both merges the list and triggers the per-key invalidator, duplicate event/session updates coalesce, and `kind: "session-removed"` removes list/detail cache state.
3. Implement removal with:

```ts
queryClient.setQueryData<SessionSummary[]>(["sessions"], (prev) =>
  prev?.filter((s) => s.sessionId !== sessionId),
)
queryClient.removeQueries({ queryKey: ["session", sessionId] })
```

4. Keep one throttle instance per mounted bridge and dispose it on unmount.
5. Run `pnpm --filter @eve-studio/ui test -- studio-stream.test.ts` and commit `fix(ui): refresh direct session queries`.

## Task 2: Keep the open turn current

**Files:**

- Modify `packages/ui/src/components/studio/message-list.tsx`
- Modify `packages/ui/src/components/studio/message-list.test.tsx`

1. Add a failing component test that opens a turn, rerenders with appended text/tool state for the same turn ID, and observes updated drawer/copy content.
2. Store `openTurnId: string | null`, derive `openTurn = turns.find(...) ?? null`, and pass IDs from row handlers.
3. Close automatically only if the turn disappeared from the reduced window.
4. Run the focused component test and commit `fix(ui): keep open turn details live`.

## Task 3: Add transcript follow and jump-to-latest

**Files:**

- Create `packages/ui/src/lib/scroll-follow.ts`
- Create `packages/ui/src/lib/scroll-follow.test.ts`
- Modify `packages/ui/src/routes/sessions.$sessionId.tsx`
- Modify `packages/ui/src/components/studio/message-list.tsx` only if ownership of the viewport belongs there after inspection

1. Add pure failures around a `64px` bottom threshold and state transitions: initially following, content growth while near bottom, manual scroll away, growth while paused, jump action.
2. Implement:

```ts
export function isNearBottom({ scrollTop, clientHeight, scrollHeight }, threshold = 64) {
  return scrollHeight - scrollTop - clientHeight <= threshold
}
```

3. Attach the ref/onScroll to the actual overflow container. On transcript growth, call `scrollTo({ top: scrollHeight, behavior: "smooth" })` only in follow mode. Respect `prefers-reduced-motion` by using `auto`.
4. Render a keyboard-accessible `Jump to latest` button when paused and unseen content arrives.
5. Add component coverage for visibility/action, run focused tests, and commit `feat(ui): follow live transcript updates`.

## Task 4: Disambiguate projects and restore root navigation

**Files:**

- Modify `packages/ui/src/lib/session-meta.ts`
- Modify `packages/ui/src/lib/session-meta.test.ts`
- Modify `packages/ui/src/components/studio/session-list.tsx`
- Modify `packages/ui/src/routes/index.tsx`
- Add or modify a focused route/component test

1. Add a failing grouping test with two equal project names and different root digests. Require separate groups; identical name/root sessions remain together.
2. Return structured groups `{ key, label, sessions }`; append a short root suffix only for colliding display names.
3. Update the sidebar mapping and keys.
4. Add a visible sidebar trigger to the empty/root state, positioned consistently with `SessionHeader`, and test its accessible name.
5. Run UI tests and commit `fix(ui): keep session navigation reachable`.

## Task 5: Show recoverable projection diagnostics

**Files:**

- Modify `packages/ui/src/routes/sessions.$sessionId.tsx`
- Modify `packages/ui/src/components/studio/session-banners.tsx`
- Modify `packages/ui/src/components/studio/session-banners.test.tsx`

1. Update API types from the runtime plan and add failing banner tests for one/multiple skipped events.
2. Continue rendering the reduced conversation even when diagnostics exist. The fatal `reducerError ? null` gate must be removed.
3. Render a warning such as `Studio skipped 2 events while building this conversation. Latest: message.appended at 14 — …` with bounded text supplied by the server.
4. Run focused tests and commit `fix(ui): surface projection recovery`.

## Task 6: Add the packaged deep-link browser gate

**Files:**

- Modify root `package.json`
- Modify `pnpm-lock.yaml`
- Create `scripts/smoke-browser.mjs`
- Modify `scripts/smoke-studio.mjs`

1. Add Playwright at the verified current stable version as a root dev dependency.
2. Add `smoke:browser`: build once, boot the CLI with `--scan-disk` on an isolated port, fetch the fixture session ID, and launch Chromium.
3. Register evidence collectors before navigation:

```js
page.on("pageerror", (error) => failures.push(`pageerror: ${error.message}`))
page.on("console", (message) => {
  if (message.type() === "error") failures.push(`console: ${message.text()}`)
})
page.on("response", (response) => {
  if (response.status() >= 400 && isCritical(response.url())) failures.push(...)
})
```

4. Cold-open the direct URL, assert header plus both `MOCK[...]` messages, assert loading disappears, reload, and repeat. Always close browser/server in `finally`.
5. Extend HTTP smoke with a direct path branded-shell check.
6. Run `pnpm exec playwright install chromium`, then `pnpm smoke:browser`. Commit `test(ui): cover cold session deep links`.

## Task 7: Studio verification

```sh
pnpm --filter @eve-studio/ui test
pnpm --filter @eve-studio/ui typecheck
pnpm build:studio
pnpm smoke:studio
pnpm smoke:browser
```

Use a fresh browser profile for one manual pass at narrow and desktop widths. Confirm direct load, collapse/reopen, streaming follow, scroll pause/jump, drawer freshness, and no console/network errors.
