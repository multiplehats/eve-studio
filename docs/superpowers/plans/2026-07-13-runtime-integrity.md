# Runtime integrity implementation plan

> Execute test-first. Do not alter stored event payloads to satisfy Eve's reducer; the adapter is projection-only.

**Goal:** Make capture/reduction reliable, non-destructive, locally bounded, and consistent with Eve `>=0.22.3 <0.23.0`.

**Architecture:** The extension emits compact deltas through one serialized forwarder. The collector wraps Eve's reducer with local delta accumulation, tolerates gaps/bad events, and publishes bounded summary notifications. Configuration validation is shared through small pure helpers.

**Stack:** TypeScript, Node 24 HTTP, Eve 0.22.4 reducer, Vitest.

---

## Task 1: Project live deltas through Eve's reducer

**Files:**

- Create `packages/studio/src/message-reduction.ts`
- Create `packages/studio/test/message-reduction.test.ts`
- Modify `packages/studio/src/registry.ts`
- Modify `packages/studio/test/reduce.test.ts`

1. Add failing adapter tests for two appended deltas before completion, interleaved `(turnId, stepIndex, sequence)` keys, completion cleanup, malformed pass-through, and a fresh adapter without prior state.
2. Run `pnpm --filter eve-studio test -- message-reduction.test.ts` and confirm the missing module/failing behavior.
3. Implement a wrapper with this public shape:

```ts
export interface MessageProjection {
  initial(): unknown
  reduce(state: unknown, event: { type: string; data?: unknown }): unknown
}

export function createMessageProjection(): MessageProjection
```

For valid appended data, derive a stable key, concatenate `messageDelta`, and pass `{ ...event, data: { ...data, messageSoFar } }` only to the underlying reducer. Clear the key on matching completion.
4. Change `SessionRecord.reducer` to this adapter and initialize state through it.
5. Add a registry regression proving `reducedState` contains live text after `message.appended` with no `message.completed`, while the stored event still has no `messageSoFar`.
6. Run the two focused suites and commit `fix(studio): project live message deltas`.

## Task 2: Serialize forwarder delivery

**Files:**

- Modify `packages/extension/test/forwarder.test.ts`
- Modify `packages/extension/ext/lib/forwarder.ts`

1. Add failing tests using deferred responses for maximum concurrency one, terminal joining/draining, `500` requeue, queue order after failure/cap, and one overall timeout around a hanging active request.
2. Run `pnpm --filter @eve-studio/extension test -- forwarder.test.ts` and confirm the race/status assertions fail.
3. Replace `#send` races with a single `#drainPromise`. A send must require `response.ok`:

```ts
const response = await boundedFetch(...)
if (!response.ok) throw new Error(`collector responded ${response.status}`)
```

4. Requeue a failed batch before newer queued entries, then trim once from the front to retain the newest `maxQueue` events. Keep `push` synchronous and catch every internal rejection.
5. Make `flushTerminal` clear the timer, capture one deadline, join the active drain, and request forced drains until the queue present at entry is acknowledged or the deadline elapses.
6. Run focused tests and commit `fix(extension): serialize collector forwarding`.

## Task 3: Make mount creation reversible and non-destructive

**Files:**

- Modify `packages/studio/src/mount.ts`
- Modify `packages/studio/src/cli.ts`
- Modify `packages/studio/test/bootstrap.test.ts`

1. Add failing tests for unrelated existing content preservation, exact-content idempotency, and a typed conflict.
2. Introduce:

```ts
export type MountResult =
  | { kind: "ready"; command: string[]; mountFile: string; created: boolean }
  | { kind: "conflict"; command: string[]; mountFile: string }
```

Use `writeFileSync(path, generated, { flag: "wx" })`; on `EEXIST`, read and compare exact generated content.
3. Update the CLI to skip install on conflict and print manual instructions. On install failure, `rmSync` only when `created === true`.
4. Extract a small pure rollback predicate if top-level CLI behavior otherwise cannot be tested.
5. Run `pnpm --filter eve-studio test -- bootstrap.test.ts` and commit `fix(studio): preserve existing extension mounts`.

## Task 4: Validate compatibility, port, and root identity

**Files:**

- Modify `packages/studio/src/version-gate.ts`
- Modify `packages/studio/src/cli.ts`
- Modify `packages/studio/test/bootstrap.test.ts`
- Create `packages/extension/ext/lib/config.ts`
- Create `packages/extension/test/config.test.ts`
- Modify `packages/extension/ext/hooks/studio-forward.ts`
- Modify `packages/extension/package.json`

1. Add failing compatibility cases for `0.22.2`, `0.22.3`, `0.22.4`, `0.23.0`, `1.0.0`, malformed, and prerelease versions.
2. Replace `meetsMinimum` with `supportsEveVersion(version, ">=0.22.3 <0.23.0")` using strict numeric parsing. Update the CLI error to name the complete range.
3. Add pure `parseStudioPort` tests for missing, `1`, `65535`, `0`, negative, decimal, whitespace-padded, overflow, and authority-like strings. Invalid extension config returns `undefined`; the hook remains inert instead of creating a URL.
4. Use `createHash("sha256").update(process.cwd()).digest("hex").slice(0, 12)` for root identity and add a helper test that proves it is stable and not reversible path text.
5. Align the extension peer dependency to `>=0.22.3 <0.23.0`.
6. Run both package tests/typechecks and commit `fix: enforce local runtime compatibility`.

## Task 5: Recover from gaps and bad reducer events

**Files:**

- Modify `packages/studio/src/types.ts`
- Modify `packages/studio/src/registry.ts`
- Modify `packages/studio/test/reduce.test.ts`
- Modify `packages/studio/test/registry.test.ts`

1. With fake timers, add failures for leading-gap expiry without another ingest, interior-gap expiry, gap cancellation, and a malformed known event followed by a valid event.
2. Change session diagnostics from one fatal string to a bounded list:

```ts
export interface ProjectionDiagnostic {
  position: number
  eventType: string
  message: string
}
```

Retain at most the latest five.
3. Schedule one unref'd recovery timer when the next stored position is above `reducedUpTo`. On expiry, jump to the next stored position; reset the projection only for a leading/rebased window. Mark `gap`, continue reduction, and emit a session update.
4. On reducer throw, append a sanitized diagnostic, increment `reducedUpTo`, and continue. Never include stacks or arbitrary event bodies in the API error.
5. Clear timers when a gap fills or a session is evicted.
6. Run focused registry/reduction suites and commit `fix(studio): recover stalled session projections`.

## Task 6: Enforce the local server boundary and bounded notifications

**Files:**

- Modify `packages/studio/src/types.ts`
- Modify `packages/studio/src/registry.ts`
- Modify `packages/studio/src/server.ts`
- Modify `packages/studio/test/registry.test.ts`
- Modify `packages/studio/test/server.test.ts`

1. Add failing server tests for non-loopback host rejection, missing/wrong content type (`415`), browser `Origin` (`403`), valid extension-style JSON (`204`), event SSE payload without raw body, and slow-client disconnect behavior at a testable helper boundary.
2. Add `maxSessions` (default `200`) to registry options. When a new session exceeds it, evict the oldest terminal session first, otherwise the oldest session; emit `{ kind: "session-removed", sessionId }`.
3. Cache each stored event's UTF-8 byte size with `Buffer.byteLength(serialized, "utf8")` and use it during eviction.
4. Narrow event updates to `{ kind: "event", sessionId, position }`.
5. Reject `host !== "127.0.0.1"` before listening. Require JSON media type and no `Origin` on ingest.
6. Centralize SSE writes; if `res.write(frame) === false`, end the response and unsubscribe it. Ensure heartbeats use the same policy.
7. Run Studio tests/typecheck and commit `fix(studio): bound the local collector`.

## Task 7: Runtime integration verification

1. Run:

```sh
pnpm --filter @eve-studio/extension test
pnpm --filter eve-studio test
pnpm --filter @eve-studio/extension typecheck
pnpm --filter eve-studio typecheck
pnpm build:release
pnpm smoke:studio
```

2. Inspect `/api/sessions/<id>` from the smoke fixture: no cumulative payloads in raw events, live/complete text present, no diagnostics.
3. Run `git diff --check` and commit any test-only corrections separately.
