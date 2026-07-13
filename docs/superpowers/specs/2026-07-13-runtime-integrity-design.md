# Runtime integrity design

**Date:** 2026-07-13  
**Status:** Approved for implementation under the maintainer's full-autonomy launch brief

## Goal

Make local capture dependable without adding latency or failure modes to the observed eve agent. The browser must show live assistant text, terminal flushes must not overtake in-flight batches, mounting must never destroy user code, and one malformed or missing event must not freeze the rest of a session.

## Constraints

- The extension remains best-effort and must never throw into an eve turn.
- Capture remains local-only and read-only.
- `messageSoFar` stays off the wire; sending the cumulative projection for every token would make traffic quadratic.
- Stored raw events stay faithful to the compact delta stream. Compatibility adaptation happens only at reduction time.
- Recovery must be visible through a degraded/diagnostic state rather than silently claiming a perfect transcript.

## Live message projection

Add a small collector-side adapter in `packages/studio/src/message-reduction.ts`. It owns Eve's default message reducer plus an accumulator keyed by `turnId`, `stepIndex`, and `sequence`. For a valid `message.appended` event, it appends `messageDelta` to the key's prior text and supplies a synthetic `messageSoFar` only to the ephemeral event passed into Eve's reducer. `message.completed` clears the matching accumulator entry. Unknown or malformed events pass through so the registry's reducer error recovery remains authoritative.

Every rebuild creates a fresh adapter. This prevents text from an evicted or rebased projection bleeding into the new window. Tests must observe text before `message.completed`, interleaved keys, completion cleanup, and clean rebuild state.

## Forwarding

Replace independent fire-and-forget sends with a single-flight drain loop:

1. `push` appends under the queue cap and schedules a drain.
2. At most one POST exists at a time.
3. A successful `2xx` response acknowledges exactly the submitted batch.
4. Network errors, timeouts, and non-`2xx` responses reinsert the failed batch in original order, apply the cap once, and start backoff.
5. `flushTerminal` cancels the batch timer, joins the active drain, and drains all events that were queued when the call began, under one overall timeout.

The terminal bound is more important than guaranteed delivery: if a collector is hung, the hook returns on time and preserves as much of the capped queue as possible.

## Safe mount transaction

`scaffoldMount` uses exclusive creation:

- Missing file: create the exact generated export and return `created: true`.
- Existing exact generated file: reuse it and return `created: false`.
- Existing different file: return a typed conflict; never overwrite it.

The CLI may remove a mount file after install failure only when this invocation created it. Existing files are never deleted. Conflict output gives manual instructions and continues without capture.

## Gap and reducer recovery

Each session owns at most one unref'd gap timer. If `reducedUpTo` is absent while a higher stored position exists:

- a gap filled within the dwell is reduced normally and does not degrade the session;
- an expired leading gap resets the adapter at the first retained event;
- an expired interior gap skips to the next stored event while preserving the already-reduced prefix;
- recovery marks `summary.degraded = "gap"` and emits a session refresh.

If Eve's reducer throws, the registry retains the raw event, records a bounded diagnostic containing position, event type, and error text, increments past that event, and continues reducing later events. A single bad recognized event therefore cannot permanently poison the conversation. The API exposes diagnostics; the existing banner becomes a warning that names skipped projection events, not a fatal all-or-nothing error.

## Local boundary and bounded process behavior

- The server runtime-rejects any host other than `127.0.0.1`.
- CLI and extension ports must be decimal integers in `1..65535`. Invalid extension configuration disables forwarding safely.
- `/ingest` requires `application/json` and rejects browser requests carrying `Origin`.
- Project root identity becomes a truncated SHA-256 digest instead of reversible base64.
- Registry byte accounting uses UTF-8 bytes.
- Add a conservative session-count cap with deterministic oldest-terminal-first eviction and a `session-removed` stream update.
- SSE event notifications omit raw event bodies. A slow client whose socket applies backpressure is disconnected and automatically reconnects to a fresh snapshot.

The existing per-session raw-event cap remains a retention cap, not a promise that Eve's reduced conversation object has a hard byte ceiling. A full projection-window protocol is intentionally outside this launch patch.

## Supported Eve range

Use one explicit compatibility window everywhere: `>=0.22.3 <0.23.0`. The CLI rejects prereleases, older versions, and `0.23+` with a message that names the supported range. The extension peer dependency and both package READMEs use the same string.

## Verification

Unit tests cover every transition above with fake timers and deferred fetches. Integration smoke must still pass with the real extension, real collector, and Eve mock model, while asserting live delta text before a completion event where practical.
