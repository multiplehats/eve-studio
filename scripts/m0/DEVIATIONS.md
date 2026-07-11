# M0 Deviations & Contract Findings

Running log of every place the working code differs from the plan's shown code (or
confirms it) against eve 0.22.4. Later tasks append; the M0 findings doc is written
from this file plus script outputs.

## Task 2: Probe extension package

### Key contract points (verified against installed dist)

- **Discovery key `eve.extension`** — as planned. `discover/extensions.js`
  `locateExtensionMount` reads `f.eve?.extension` as the required source-root field;
  a missing/empty value raises `discover/extension-package-invalid` with the message
  "missing the `eve.extension` source-root field."
- **Import path `eve/extension` (singular)** — as planned. `eve` package.json exports
  map has `"./extension"` (and `"./hooks"`); no `"./extensions"` key exists.
  `public/extension/index.js` re-exports `defineExtension`.
- **Extension entry filename `ext/extension.ts`** — as planned. `discover-agent.js`
  requires the source-root entry to be `extension.ts` (or another supported module
  extension); `index.ts` is not a recognized slot.
- **Hooks slot `ext/hooks/<name>.ts` via `defineHook` from `eve/hooks`** — as planned.
  `defineHook` exported from `eve/hooks` (`public/definitions/hook.js`); the `"*"`
  wildcard key is documented as matching every accepted runtime stream event and runs
  after any typed handler.
- **Mount = re-export default** — as planned. `locateExtensionMount` requires the mount
  file to default-export a mounted extension; the dist's own diagnostic message gives
  `export { default } from "@acme/crm"` as a valid form (exactly what we used).
- **Mount namespace = mount filename** — as planned. `mountNamespace()` in
  `extensions.js` derives the namespace from the file basename (minus extension), so
  mount `examples/demo-agent/agent/extensions/studio.ts` yields namespace `studio`.
- **Hook context shape** — as planned. `HookContext` extends `SessionContext`; the
  session id is exposed as `ctx.session.id` (string). Runtime stream events carry a
  top-level `type` and `meta.at` (`HandleMessageStreamEventMeta { at: string }`), matching
  the probe's `{ sid, seq, type, at, raw }` projection.

### Code deviations from the brief's shown code

- **`packages/extension/tsconfig.json` — dropped `extends`, inlined compilerOptions.**
  The brief showed `{ "extends": "../../tsconfig.base.json", "include": ["ext", "test"] }`.
  With that form, `eve dev` bundling of the extension's authored hook failed at runtime:
  `/eve/v1/info` returned HTTP 500 with
  `[TSCONFIG_ERROR] Failed to load tsconfig for '...node_modules/@eve-studio/extension/tsconfig.json': Tsconfig not found`.
  Root cause: eve resolves the mounted extension through the pnpm symlink at
  `examples/demo-agent/node_modules/@eve-studio/extension` (→ `packages/extension`). The
  bundler reads `tsconfig.json` there, but its `extends: "../../tsconfig.base.json"`
  resolves against the *logical* symlink path (`node_modules/@eve-studio/extension/`),
  so `../../` lands in `node_modules/`, where `tsconfig.base.json` does not exist. Classic
  symlink + relative-`extends` break. Fix: inline the base compilerOptions verbatim and
  drop `extends`, which also makes the package self-contained (a published extension
  cannot `extends` a monorepo-root file that won't exist downstream). After the fix,
  `/info` returned 200 and the hook appeared. `eve build` and `tsc -p tsconfig.json`
  (exit 0) both still pass — different code path from the dev bundler.
- All other shown code (package.json, extension.ts, studio-forward.ts, mount re-export)
  matched eve 0.22.4 verbatim; no other adaptation needed.

### Observed hook slug in `/info` (M0-a gate: PASS)

The extension-contributed wildcard hook IS discovered. `/eve/v1/info` `hooks` array
listed it as a distinct, namespaced entry (alongside the pre-existing local control
hook `studio-test`):

```json
{
  "logicalPath": "../node_modules/@eve-studio/extension/ext/hooks/studio-forward.ts",
  "sourceId": "ext:studio:hooks/studio-forward.ts",
  "sourceKind": "module",
  "eventNames": [],
  "slug": "studio__studio-forward"
}
```

- Observed slug: **`studio__studio-forward`** — exactly as predicted (`<mount>__<hook>`,
  mount file `studio.ts` + hook file `studio-forward.ts`). As planned.
- `sourceId` `ext:studio:hooks/studio-forward.ts` confirms it arrived via the extension
  package through the `studio` mount namespace (not as a local agent hook).
- `eventNames: []` — the wildcard `"*"` subscriber does not enumerate individual event
  names in `/info`; discovery of the hook itself is nonetheless proven.

Sanity check (one cheap OpenRouter call): POST `/eve/v1/session` with a PONG prompt
wrote 9 NDJSON lines to `$EVE_STUDIO_PROBE_FILE` (`/tmp/eve-studio-probe.ndjson`),
per-session `seq` 0..8, full lifecycle (`session.started` → `turn.completed` →
`session.waiting`). Sample line:
`{"sid":"wrun_01KX5K86CYFM45YNWJF8A9M6VE","seq":0,"type":"session.started","raw":{"data":{"runtime":{"agentId":"demo-agent",...}},"type":"session.started"}}`
Note: the events delivered to the hook in the dev path carry `data`+`type` but no
`meta`, so the projected `at` field is `undefined` — the brief's optional-chaining guard
`(event as {meta?:{at?:string}}).meta?.at` handles this without error. The probe FIRED.

**HANDOFF TO TASK 3 (timestamp gap):** `JSON.stringify` drops `undefined` keys, so the
emitted NDJSON lines currently have shape `{sid, seq, type, raw}` with **no timestamp
field at all** — neither a top-level `at` nor anything inside `raw` (`{data, type}`).
The dist read showed `HandleMessageStreamEventMeta { at: string }` is stamped on the
*persisted* event, but the object handed to the `"*"` hook at `event.meta` does not
expose it in this dev runtime. The brief's interface lists `at` in the shape, so this is
currently unfulfillable. Task 3 MUST determine whether the timestamp is reachable via a
different path (a sibling handler arg, `ctx`, or different nesting in `event`) or is
genuinely absent for wildcard hooks in this runtime — otherwise every captured event is
timestamp-less. Not a Task 2 blocker: discovery + firing are the Task 2 deliverable and
both are proven.

## Task 3: extension hook parity with the durable stream (M0-a, M0-c)

### Findings JSON (verbatim script output — exit 0)

```json
{
  "hookFired": true,
  "orderMatchesStream": true,
  "seqAlignsWithStartIndex": true,
  "eventIdField": null
}
```

Live run against `eve dev` on port 43117, model `openrouter/anthropic/claude-haiku-4-5`,
one PONG session (`sessionId = wrun_01KX5KXGJVSKZRCD1RDF3XXBYJ`). Port verified clean
after (`lsof -ti tcp:43117 -sTCP:LISTEN` → empty).

- **M0-a (hook observes the session identically to the durable stream): PASS.** The
  wildcard hook captured exactly 9 events; the `/eve/v1/session/:id/stream?startIndex=0`
  replay returned exactly 9 events; types matched **in order**:
  `session.started, turn.started, message.received, step.started, message.appended,
  message.completed, step.completed, turn.completed, session.waiting`.
- **seq ↔ startIndex alignment: PASS.** The hook's per-session `seq` (0..8) equals the
  stream replay position `i` for every event — the wildcard hook is dispatched in the
  same order the durable stream materializes, with no gaps or reordering.
- **M0-c (wire events carry a stable per-event ULID id): the answer is NO —
  `eventIdField: null`, and this is a real finding, not a regex miss.** Confirmed by
  dumping and eyeballing full wire events (below, incl. inside `data`): no `evnt_` ULID
  and no per-event `id` appears anywhere on the stream event or the hook `raw`. The
  `evnt_` ULIDs exist only on the internal `.workflow-data/events/*.json` workflow-engine
  records — a *different* event stream (see workflow-data section).
  **What the wire DOES carry (looked inside `data`):** turn/step-level identifiers, not a
  per-event id — `data.turnId` (`"turn_0"`), `data.sequence` (turn seq), `data.stepIndex`,
  and on `session.started` `data.runtime.agentId`. These identify the turn/step, not the
  individual event, so several events in one step share the same triple.
  **Plan B dedup-key impact:** there is no wire-level per-event ULID to dedup on, so a
  dedup key must be synthesized. Candidates (open question, not decided here):
  - `sid + startIndex` — soundest for a *durable* key: `startIndex` is the server-side
    durable stream position (what the stream replays against).
  - `sid + seq` — cheaper but the hook's `seq` is a client-side counter in the hook
    process that resets on restart; not durable across a hook-process restart.
  - `sid + meta.at` — only if the timestamp is made reachable at the hook (it is not
    today; see Observation 1).

### Observation 1 — hook `raw` vs stream event JSON key-set diff (meta.at follow-up)

Same event (`seq 0` / stream index 0, `session.started`), compared verbatim:

| source | top-level keys | timestamp | id |
|---|---|---|---|
| **stream replay event** | `data, type, meta` | `meta.at` = `"2026-07-10T08:57:12.085Z"` ✅ | none |
| **hook `raw` (probe)** | `data, type` | absent ❌ (no `meta`) | none |

**The STREAM version carries `meta.at`; the hook version does not carry `meta` at all.**
This resolves the Task 2 handoff question: `meta.at` (and only `meta.at` — still no id) is
**stamped after the hook dispatch point**. The object handed to the `"*"` wildcard hook is
the raw `{data, type}` event *before* the runtime attaches `meta`; the durable stream (and
the persisted record) is the post-stamp view. So the probe's `at` is genuinely
unreachable via `event.meta` for wildcard hooks in this runtime — it is not a nesting
mistake. If Plan B needs a per-event timestamp at the hook, it must come from another
source (hook-side `Date.now()`, or reconcile against the stream/`.workflow-data` by
`sid+seq`), because the event as delivered to the hook has none.

Artifacts from this run (scratchpad, not committed): `stream-events.json`,
`probe-events.json`, `workflow-data-delta.json`.

### Observation 2 — .workflow-data real-time check

The verify script snapshots `examples/demo-agent/.workflow-data/events/` (file → mtimeMs)
before the session and after, and dumps the delta (non-fatal, not a gate).

- **(a) Did new event files for OUR session's wrun id appear?** Yes. 13 new files named
  `wrun_01KX5KXGJVSKZRCD1RDF3XXBYJ-evnt_<ULID>.json` appeared for our session
  (plus a sibling set for a spawned child run `wrun_01KX5KXGM22ATDHY0X3HEE2YBS` — a
  child/subagent workflow within the same turn).
- **(b) Real-time writes vs one post-hoc flush?** Real-time / incremental. Our session's
  file mtimes are staggered monotonically from `08:57:12.037Z` to `08:57:13.494Z`
  (~1.45 s span, distinct sub-ms timestamps per file), i.e. written **as the turn
  progressed**, not a single end-of-turn flush.
- **(c) File JSON shape — does it carry `meta.at` and the `evnt_` id?** These are
  **workflow-engine** events, distinct from the wire/stream events. Shape:
  ```json
  {
    "eventType": "hook_disposed",       // e.g. step_started, step_completed, hook_disposed
    "specVersion": 5,
    "correlationId": "hook_01KX5KXGJV671SZNC3JQ8CCFS4",
    "eventData": { "token": "wrun_...:turn-control:0" },
    "runId": "wrun_01KX5KXGJVSKZRCD1RDF3XXBYJ",
    "eventId": "evnt_01KX5KXJ0JDHQH5MMF54STR41N",
    "createdAt": "2026-07-10T08:57:13.490Z"
  }
  ```
  It carries an `evnt_` ULID (`eventId`) and a `createdAt` timestamp — but there is **no
  `meta.at`** and no wire `type` (`session.started` etc.). This is the engine's internal
  step ledger, not the `/eve/v1/session/:id/stream` event stream. So the `evnt_` ULID the
  M0-c regex hunts for lives *here*, on a different stream, which is exactly why
  `eventIdField` is `null` for the wire events. Recorded observation only — the verify
  script does **not** gate on `.workflow-data`.

### Deviations from the brief's shown script

All assertions and the `readNdjsonUntilIdle` drain are **verbatim**. Three additive,
non-fatal changes (none touch the gate logic; each earns its keep on a single paid run):

1. **Artifact dump.** Added a `try/catch` block that writes `streamEvents`, `probeEvents`,
   and the `.workflow-data` before/after delta to the scratchpad. Rationale: the verbatim
   script prints only the findings JSON and `streamEvents` lives only in memory, so the
   two required observations (key-set diff, M0-c confirmation) could not be done without a
   second OpenRouter call. Wrapped so any failure is logged and ignored.
2. **`.workflow-data` snapshot helpers.** Added `snapshotEventsDir()` and `before`/`after`
   captures around the session to satisfy the user-requested real-time check. Non-fatal,
   no gate dependency, as the brief requires.
3. **Kill-by-port in `finally`.** The brief's script only does `server.kill("SIGTERM")` on
   the `pnpm` process; the `eve dev` grandchild frequently survives and holds port 43117.
   Added a guarded `lsof -ti tcp:43117 -sTCP:LISTEN | xargs kill` in `finally` (the task
   explicitly requires kill-by-port). Also added GATE-FAIL diagnostics that print the
   probe/stream type lists and the distinct probe sids **only on failure** — expose the
   diff, never weaken the assertion. (No gate fired this run, so diagnostics stayed quiet.)

Timing note: the default 15 s wait was sufficient — the model was fast (turn completed
~1.4 s after session start per mtimes) and the stream replay (9) matched the probe (9)
exactly, so no wait bump was needed.

Startup noise (not a finding): `eve dev` logged `Re-enqueued 3 active run(s)` and repeated
`Queue message failed ... Unhandled queue` for three OLD `wrun_` ids from prior sessions
(persisted local queue). These are leftover pre-existing runs, unrelated to our new
session; our session (`wrun_01KX5KXGJVSKZRCD1RDF3XXBYJ`) ran and completed cleanly.

### eve build exports map written into packages/extension/package.json

eve's extension build (`prepare` script → `eve build`, run automatically by pnpm on
install) generated and wrote the managed `exports` map back into
`packages/extension/package.json` on disk (this file was NOT hand-authored):

```json
"exports": {
  ".": { "types": "./dist/index.d.ts", "default": "./dist/index.mjs" },
  "./tools": { "types": "./dist/tools/index.d.ts", "default": "./dist/tools/index.mjs" }
}
```

Committed as-written. `dist/` also generated (`index.mjs`, `index.d.ts`, `tools/`).

## Task 4: eval-path capture and terminal flush across server close (M0-b, M0-d)

Run date: 2026-07-10. eve 0.22.4, demo-agent fixture, OpenRouter (`anthropic/claude-haiku-4-5`).
`node scripts/m0/verify-eval.mjs` from repo root. Ports 43117/43118 verified free after
every run (`lsof`).

### Findings JSON (verbatim, final run)

```json
{
  "evalExitCode": 0,
  "evalHookFired": true,
  "terminalEventSurvivedClose": false,
  "terminalFlushLatencyMs": null
}
```

Non-gating awaited-flush mechanism probe (verbatim):

```json
{
  "waitingEventObserved": true,
  "waitingFlushSurvivedClose": true,
  "waitingFlushLatencyMs": 8
}
```

`hookCapturedWireEvents = 10` this run. This counter is `probe.filter(e => e.type !==
"__flush").length` — it excludes `__flush` but NOT `__waiting_flush`, so 10 = **9 real wire
events (all the eval's OWN session) + 1 `__waiting_flush` marker line**. There is NO stale
session's wire event in this count: the re-enqueued runs fail immediately on startup
("Unhandled queue") and never emit to the hook — which is also why the collector received
exactly one line, not two. The verify script **exits 1**: the terminal gate correctly
refuses to pass without a real terminal event. This is a FINDING, surfaced honestly, not a
bug to patch around.

### Interpretation (the M0 answers)

- **M0-b: YES.** Hooks fire inside `eve eval`'s ephemeral in-process dev server
  (`eval.js`: `createDevelopmentServer(root, {host:"127.0.0.1", port:0})` → `p.start()` →
  run → `finally { await p.close() }`). `evalHookFired: true`; the hook captured the full
  wire sequence with parity to the durable stream on disk.

- **M0-d (terminal path): NOT EXERCISED — lifecycle finding, NOT a flush failure.**
  `terminalEventSurvivedClose: false` / `terminalFlushLatencyMs: null` are **lifecycle
  facts**. A single-turn `eve eval` **parks the session at `session.waiting` and never
  emits any terminal event** (`session.completed` / `result.completed` / `session.failed`).
  Confirmed three ways for the eval's own session id:
  1. The hook was never invoked for a terminal event (the per-event `appendFileSync` runs
     BEFORE the `TERMINAL` check; no terminal line was ever written → the branch never ran).
  2. The durable wire stream on disk (`.workflow-data/streams/chunks/strm_<ulid>_user/`,
     base64-JSON `.bin` chunks — **manually decoded**) ends at `session.waiting`. Full
     sequence: `session.started, turn.started, message.received, step.started,
     message.appended, message.completed, step.completed, turn.completed, session.waiting`.
     No terminal event present.
  3. `.workflow-data/events/` holds only engine events (`run_created`, `step_started`,
     `hook_created`, `step_completed`, …) — no wire terminal event there either.

- **M0-d (mechanism): PROVEN on the eval path via `session.waiting`.**
  Because no terminal event fires here, the only way to answer the *actual* M0-d question —
  "does an awaited, bounded (≤500ms) hook flush complete before `p.close()`?" — is to probe
  the last event whose hook IS dispatched inline before close, which is `session.waiting`.
  Result: `waitingFlushSurvivedClose: true`, `waitingFlushLatencyMs: 8ms` (well under 500).
  The awaited POST reached the external collector on 43118 before the eval's `finally {
  await p.close() }`. Strong support that Studio's awaited-hook-flush design is viable on
  the eval path. **Caveat:** NOT proof a hypothetical `session.completed` would survive —
  that event never dispatches on a single-turn eval (see open question).

### Deviations from the brief (reality forced these)

1. **`evals/evals.config.ts` is REQUIRED by eve 0.22.4 (added file).** The brief's Warning
   treated it as optional (judge-only). In 0.22.4 `discoverEvalConfig` (in
   `evals/runner/discover.js`) throws `Missing required eval config at
   evals/evals.config.ts` and `eve eval` exits code 2 BEFORE any turn runs if the file is
   absent. First run reproduced exactly this (`evalExitCode: 2`, all gates false). Fix:
   added `examples/demo-agent/evals/evals.config.ts` = `defineEvalConfig({})` (empty; the
   M0 eval uses no `t.judge.*`, so no judge model needed). Verified valid against
   `define-eval-config.d.ts`.

2. **`verify-eval.mjs` hardened with try/finally + guarded reads (adaptation).** The
   brief's verbatim script `rmSync(PROBE)` then unconditionally `readFileSync(PROBE)` after
   `collector.kill()`; on any negative path (hook never fires → PROBE absent) it throws,
   skips the findings print, and can leak port 43118. Adapted: eval spawn wrapped in
   try/finally (collector always killed); PROBE/CFILE reads guarded with `existsSync` +
   try/catch so the findings JSON always prints even when a gate is false. Gate logic and
   thresholds unchanged.

3. **Non-gating `session.waiting` measurement probe added to the hook + verify script.**
   Distinct marker `__waiting_flush` and a distinct `waitingFlush*` pair, so it can NEVER
   contaminate `terminalFlushLatencyMs` / `terminalEventSurvivedClose` (those still compute
   only from real terminal records → they stay `null`/`false`). MEASUREMENT-ONLY code in a
   probe hook, not intended Studio behavior. The `TERMINAL` gate set was NOT weakened
   (adding `session.waiting`/`turn.completed` to force a green gate is forbidden and was not
   done).

Note: env is safe — `eve eval` (`eval.js`) calls `loadDevelopmentEnvironmentFiles(root)`
first, which reads `.env.local` (so `OPENROUTER_API_KEY` is present); it only sets vars NOT
already in `process.env`, so the verify script's spawn-provided `EVE_STUDIO_PROBE_FILE`
survives. Confirmed no auth confound: the turn genuinely produced a model response.

### `.workflow-data` under `eve eval` (user-requested observation, non-gating)

For the eval's OWN session id (raw before/after counts are polluted by stale re-enqueued
runs — measured per-sid instead):

- **(a) NEW engine-event files appeared:** YES, in the project's own
  `examples/demo-agent/.workflow-data/` (no temp path). The eval's session produced **11
  files** in `.workflow-data/events/` (`run_created`, `run_started`, `step_created` x2,
  `step_started` x2, `step_completed` x2, `hook_created` x3) PLUS a durable wire stream
  under `.workflow-data/streams/` (`runs/<runId>.json` manifest + 9 `.bin` chunks in
  `streams/chunks/strm_<ulid>_user/`).
- **(b) Real-time (staggered mtimes).** Chunk mtimes / event `createdAt` span the ~1.3s
  turn (`newFileMtimeSpreadMs` ≈ 1384–1556ms; per-event `meta.at` `…31.218Z` → `…32.505Z`).
  Not flushed-at-close.
- **(c) `message.appended` streaming delta EXISTS on disk** — in the DURABLE WIRE STREAM
  (`.workflow-data/streams/chunks/*.bin`, **manually decoded** = base64 JSON of wire events
  incl. `message.appended`), NOT in `.workflow-data/events/` (which is step/engine-level:
  `run_created`, `step_started`, …). So "Studio watches `.workflow-data/`" CAN see streaming
  deltas, but must parse the binary `streams/chunks/` wire stream, not the `events/` engine
  log. Terminal wire events absent from BOTH on a single-turn eval.
- **(d) Engine files vs hook wire events:** ~11 engine files in `events/` vs **9
  hook-captured wire events** for the eval's session; the 9 hook events match the 9 durable
  stream chunks exactly (full parity → confirms M0-b). Different counts = different
  granularity (engine steps/hooks vs wire protocol events).

### Additional surprise (eval-path, non-gating)

**Stale run re-enqueue on server startup.** Every `eve eval` logs `[world-local]
Re-enqueued N active run(s) on startup` + `Queue message failed (… HTTP 400 "Unhandled
queue")` for prior M0-test runs that parked at `session.waiting` and were never resumed.
These stale runs also emit events during the eval, polluting a naive before/after
file-count snapshot of `.workflow-data/events/` (raw `newFileCount` 18–21, but only ~11
belong to the eval's own session). Harmless to the eval (passes, exit 0) but the shared
local `.workflow-data` queue accumulates parked runs across invocations. Clean
`.workflow-data/` between runs if a clean snapshot is needed. (Same phenomenon Task 3 noted
under `eve dev`.)

### Open question (flagged, not chased)

`EveEvalTaskResult.status` admits `"completed"`, so *some* agent turns end the session
rather than park it. This run observed **parking** (`session.waiting`); a session-ending
turn might emit a real terminal event. **Terminal-event survival on session-ending turns
remains untested** — not observed on this single-turn eval; engineering one solely to green
the gate edges toward gaming it, so it was not pursued.

## Task 6

- **`studio-forward.ts` bounded-flush trigger set renamed `TERMINAL` → `FLUSH_EVENTS` and
  extended with `"session.waiting"`, deviating from the brief's shown hook code
  (`TERMINAL = new Set(["session.completed", "session.failed", "result.completed"])`).
  Cites the Task 4 finding above (M0-d): a single-turn `eve eval` parks the session at
  `session.waiting` and never emits `session.completed` / `session.failed` /
  `result.completed`, so a flush gated only on those three terminals would lose the whole
  eval turn when the ephemeral dev server closes in `finally { await p.close() }`. The
  same Task 4 run proved the mechanism works on `session.waiting` specifically
  (`waitingFlushSurvivedClose: true`, `waitingFlushLatencyMs: 8ms`), so it was promoted
  from a measurement-only probe marker to a real flush trigger. User-approved at the M0
  gate.

## Task 7: End-to-end capture smoke (real `eve eval` → real forwarder → collector)

Run date: 2026-07-10. `node scripts/smoke-capture.mjs` from repo root, one paid OpenRouter
call (`anthropic/claude-haiku-4-5`), collector on port 43118 (`EVE_STUDIO_PORT=43118`).

### AMENDMENT (user-approved at the M0 gate)

The brief's shown script asserts `hasTerminal` against
`["session.completed", "result.completed", "session.failed"]`. Per Task 4's M0-d finding
(above): a single-turn `eve eval` parks at `session.waiting` and never emits any of those
three events, so `hasTerminal` would always be false on this path — not a bug, a lifecycle
fact already proven and cited when Task 6 promoted `session.waiting` into the forwarder's
`FLUSH_EVENTS` set. `scripts/smoke-capture.mjs` therefore asserts `hasTurnBoundary` instead,
over `["session.completed", "result.completed", "session.failed", "session.waiting"]` —
identical to the forwarder's `FLUSH_EVENTS`. Everything else (contiguous seq check,
leakedSoFar check, exit-code semantics, collector/eval spawn shape) is verbatim from the
brief.

### Smoke output (verbatim, exit 0)

```json
{"sid":"wrun_01KX5Q8VNX5ZFVSD829NTBM9S4","events":9,"contiguous":true,"hasTurnBoundary":true,"leakedSoFar":false}
```

Ports 43118/43110 verified clean after the run (`lsof -ti tcp:<port> -sTCP:LISTEN` → empty
for both).

### Envelope / batching observations (non-gating)

- **5 POST batches, 9 total envelopes, one session.** Batch shape observed from the raw
  collector NDJSON (`{events: [...]}` per line, per Task 6's contract):
  - batch 0: 3 events — `session.started, turn.started, message.received`
  - batch 1: 1 event — `step.started`
  - batch 2: 1 event — `message.appended`
  - batch 3: 3 events — `message.completed, step.completed, turn.completed`
  - batch 4: 1 event — `session.waiting` (the awaited bounded flush; matches Task 4's
    `waitingFlushSurvivedClose: true` finding — the forwarder's batching timer got preempted
    by the flush exactly once, for exactly the flush-triggering event, rather than draining
    everything in one shot)
- **`process.kind` observed as `"dev"`, not `"eval"`.** `studio-forward.ts`'s `detectKind()`
  inspects `process.argv` for the substring `"eval"`/`"dev"`/`"start"`. Because `eve eval`
  internally spins up `createDevelopmentServer(...)` (the same M0-b mechanism Task 4 already
  documented), the hook process's own argv reflects that inner dev-server invocation, not the
  outer `eve eval` CLI command — so every envelope in this run carries `process.kind: "dev"`
  even though the whole run is an eval. Not a smoke assertion (`process.kind` is not part of
  any Task 7 gate) — recorded as a real finding for Plan B/C consumers that might branch on
  `process.kind` to distinguish eval runs from dev-server runs; today they cannot.
- **`seq` is contiguous 0..8 across all 5 batches**, i.e. `seq` is a single per-session
  counter that survives across batch boundaries, not reset per POST — confirms the forwarder
  stamps `seq` before batching/queuing, matching Task 6's design.
- **`leakedSoFar: false` this run is a trivial pass, not a strip verification.** The real
  `message.appended` event captured from eve 0.22.4 on this run carries only
  `{messageDelta, sequence, stepIndex, turnId}` in `event.data` — `messageSoFar` is not
  present on the wire at all for this eval (short "PONG" reply, likely under whatever
  chunking threshold would trigger a `messageSoFar` field, if eve even emits one on this
  code path). So the assertion passes because there was nothing to leak, not because
  `buildEnvelope`'s strip (`ext/lib/envelope.ts` lines 35-38) fired and removed anything.
  The strip logic itself IS verified — at the unit level, in
  `packages/extension/test/envelope.test.ts` ("strips messageSoFar from message.appended"),
  which synthesizes a `messageSoFar` field and confirms `buildEnvelope` removes it. This
  smoke does not add end-to-end proof that a real `messageSoFar`-bearing wire event gets
  stripped before reaching the collector; it only proves no such field leaks when eve
  doesn't produce one. Not a smoke failure — the assertion is correct and verbatim from the
  brief — just a scope note on what this particular run's green checkmark does and doesn't
  demonstrate.
- Startup noise (not a finding, same phenomenon Tasks 3/4 already noted): `eve eval` logs
  `Re-enqueued N active run(s) on startup` plus repeated `Queue message failed ... Unhandled
  queue` for stale parked runs from prior M0 sessions in the shared local
  `examples/demo-agent/.workflow-data/` queue. Harmless — the eval's own session
  (`wrun_01KX5Q8VNX5ZFVSD829NTBM9S4`) ran and completed (parked) cleanly with full 9-event
  parity, matching every prior task's observation of this queue.
- **Re-run fragility (for `pnpm smoke:capture` as a recurring command).** This run's
  `bySession.size === 1` because the stale re-enqueued runs fail immediately
  ("Unhandled queue") and never reach the hook. If a stale run ever DID emit to the hook
  (e.g. a future eve version that resumes rather than rejects parked runs), the per-session
  loop would evaluate contiguity/turn-boundary/leak on that extra session too, and a
  genuinely stale/partial session could fail the smoke spuriously. Not observed this run;
  noted as a known limitation of reusing the shared `examples/demo-agent/.workflow-data/`
  queue across repeated invocations (same queue-accumulation phenomenon Tasks 3/4 recorded).

## Plan B

### Task 2: Free deterministic evals — mockModel fixture, terminal-lifecycle probe, committed envelope fixture

Run date: 2026-07-10. `examples/demo-agent/agent/agent.ts` gained the `EVE_STUDIO_MOCK=1`
branch (verbatim from the brief); `examples/demo-agent/evals/mock-probe.eval.ts` sends two
turns (`"ping one"`, `"ping two"`) through the mock model. Ran with the API key physically
absent from the environment:

```bash
cd examples/demo-agent && env -u OPENROUTER_API_KEY EVE_STUDIO_MOCK=1 EVE_STUDIO_PORT=43118 pnpm exec eve eval mock-probe --verbose
```

Result: **exit 0**, `✓ mock-probe`, "Results: 1 passed (1 total)". No OpenRouter traffic was
possible (key absent from env; `mockModel` never makes an HTTP call). Collector
(`M0_COLLECTOR_FILE=/tmp/eve-studio-planb-capture.ndjson node scripts/m0/collector.mjs`,
port 43118) received **6 POST batch lines** (`wc -l` on the raw NDJSON = 6), flattening to
**17 envelopes total for a single session** (`wrun_01KX5Z8EX40R4X8BMR4Z26X5Q9`) — same
batching pattern Task 7 documented (multiple small POSTs per turn, `seq` contiguous across
batch boundaries). Port 43118 verified free after kill
(`lsof -ti tcp:43118 -sTCP:LISTEN` → empty).

#### Fixture

`packages/studio/test/fixtures/mock-eval-envelopes.ndjson` — 17 lines, one flattened
Envelope-v1 JSON object per line, single session. Sanity checks (hand-verified):

- `v === 1` on all 17 lines.
- `process.kind === "unknown"` on all 17 lines (no `EVE_STUDIO_KIND` set for this run —
  confirms Task 1's env-based `kind` default is live, superseding the old M0 Task 2 finding
  that argv-sniffing reported `"dev"`; that code path no longer exists).
- `seq` contiguous `0..16` for the one session, spanning both turns (not reset per turn).
- Event-type sequence per turn: `session.started, turn.started, message.received,
  step.started, message.appended, message.completed, step.completed, turn.completed,
  session.waiting` (turn 1) then `turn.started, message.received, step.started,
  message.appended, message.completed, step.completed, turn.completed, session.waiting`
  (turn 2) — 2× `step.completed`, 2× `session.waiting`, 0 `session.started`-after-turn-1
  (single session reused for both turns, as expected for `t.send()` called twice on the
  same eval context).
- `messageSoFar` occurrences in the fixture: **0** (grep across the full flattened file).
- No secrets: `project.root` is a base64url hash of `process.cwd()` (`"L1VzZXJzL2No"` for
  this run — a truncated, non-reversible-to-full-path 12-char slice per
  `ext/hooks/studio-forward.ts`'s `safeRootHash()`), not a raw filesystem path. Grepped for
  `sk-`, `api[_-]?key`, `bearer`, `secret`, `password`, `OPENROUTER` — none found.

#### Usage field path (Step 5)

Verbatim `step.completed` envelope (turn 1, `seq: 6`):

```json
{
  "v": 1,
  "project": { "name": "demo-agent", "root": "L1VzZXJzL2No" },
  "process": { "instanceId": "acb70ac3-faed-4c4d-a64c-dc6b645e76da", "kind": "unknown", "pid": 60126 },
  "agent": "demo-agent",
  "sessionId": "wrun_01KX5Z8EX40R4X8BMR4Z26X5Q9",
  "channelKind": "http",
  "seq": 6,
  "hookEpoch": "57b6c173-499a-4424-b8c5-41791222bddf",
  "event": {
    "data": {
      "finishReason": "stop",
      "sequence": 0,
      "stepIndex": 0,
      "turnId": "turn_0",
      "usage": { "inputTokens": 88, "outputTokens": 5, "cacheReadTokens": 0, "cacheWriteTokens": 0 }
    },
    "type": "step.completed"
  }
}
```

**Confirmed path: `event.data.usage`** on `step.completed`, containing
`{inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens}`. **No `costUsd` field is
present** — this matches the installed `MockModelUsage` type
(`examples/demo-agent/node_modules/eve/dist/src/evals/mock-model.d.ts`), which declares only
`inputTokens?: number` and `outputTokens?: number`; `cacheReadTokens`/`cacheWriteTokens`
are additive fields eve itself stamps (defaulted to `0` for the mock path), not part of
`MockModelResponse`. `costUsd` is a real-provider-only field (OpenRouter's `includeUsage`
path) that the mock model never populates — Task 3's usage reader must treat
`event.data.usage.costUsd` as legitimately absent/undefined under mock fixtures, not as a
parse failure.

#### eveVersion field path (Step 5)

Verbatim `session.started` envelope (`seq: 0`):

```json
{
  "event": {
    "data": {
      "runtime": {
        "agentId": "demo-agent",
        "agentName": "demo-agent",
        "eveVersion": "0.22.4",
        "modelId": "eve-mock/model"
      }
    },
    "type": "session.started"
  }
}
```

**Confirmed path: `event.data.runtime.eveVersion`** (string, e.g. `"0.22.4"`) — matches the
design's predicted `eveVersion` field, nested one level deeper than `event.data.eveVersion`
(it lives under `runtime`, alongside `agentId`/`agentName`/`modelId`). Task 3's
`SessionSummary.eveVersion` reader must read `event.data.runtime.eveVersion` from the
session's `session.started` line, not `event.data.eveVersion`.

#### Terminal-lifecycle probe (Step 6, carry-forward 3)

1. `grep -n -iE "end|close|complete|finish|stop" examples/demo-agent/node_modules/eve/dist/src/evals/types.d.ts`
   — no session-ending method exists on `EveEvalContext`, `EveEvalSession`, or
   `EveEvalTurn`. The only lifecycle surface is the read-only
   `status: "completed" | "failed" | "waiting"` field on `EveEvalTurn`/execution facts;
   there is no `.close()`, `.end()`, or `.terminate()` to invoke from an eval body.
2. No session-ending API existed to drive a throwaway "invoke it" eval (step 6.2 of the
   brief is therefore inapplicable — there was no candidate to try).
3. Attempted the throw-responder path (step 6.3): a temporary, non-committed local edit to
   `agent.ts` added an `EVE_STUDIO_MOCK_THROW=1`-gated branch:
   `mockModel(() => { throw new Error("probe: forced mock failure"); })`. Ran once, free
   (`env -u OPENROUTER_API_KEY EVE_STUDIO_MOCK=1 EVE_STUDIO_MOCK_THROW=1 EVE_STUDIO_PORT=43118
   pnpm exec eve eval terminal-probe --verbose`), against a throwaway
   `examples/demo-agent/evals/terminal-probe.eval.ts` (`t.send("trigger failure")`, no
   assertions). Result: eval harness still reports **exit 0 / "✓ terminal-probe" / 1 passed**
   (eve's harness treats a parked/errored turn as a pass unless an assertion explicitly
   checks turn status) — but the wire capture (7 envelopes, one session
   `wrun_01KX5ZB772CGE00SXN4T40THQK`) shows:
   `session.started, turn.started, message.received, step.started, step.failed, turn.failed,
   session.waiting`. Verbatim `step.failed`/`turn.failed` `event.data`:
   `{"code":"MODEL_CALL_FAILED","details":{"errorId":"...","message":"Error: probe: forced
   mock failure",...},"message":"probe: forced mock failure","sequence":0,"stepIndex":0,
   "turnId":"turn_0"}` (step.failed adds `stepIndex`; turn.failed omits it). Confirmed via
   the harness log line `"model call failed — parking session for retry by the user"` —
   the runtime treats a thrown mock responder as a **retryable parked failure**, not a
   session-terminal failure: the wire sequence still ends on `session.waiting`, never
   `session.failed`.
   - The temporary `agent.ts` throw branch and `terminal-probe.eval.ts` were both reverted
     / deleted after this one probe run; `agent.ts` as committed contains only the Step 1
     code (no throw branch), and no probe eval ships.

**Outcome: NOT PRODUCIBLE.** True-terminal flush survival remains untested — no
session-ending path found under eve eval 0.22.4 mock runs. Both routes available
(exhausting the API for a session-ending method; forcing a turn failure) were tried and
neither reaches `session.completed` / `result.completed` / `session.failed` on the wire;
every observed lifecycle — success or thrown-responder failure alike — terminates in
`session.waiting`. Carry-forward 3 stays OPEN, not silently dropped. The missing
"true-terminal untested" bullet is added to §Task 7 below (carry-forward 6c).

**§Task 7 addendum (carry-forward 6c):** true-terminal flush survival
(`session.completed`/`result.completed`/`session.failed` surviving `p.close()`) remains
untested as of Task 2 of Plan B — no session-ending path exists under `eve eval` 0.22.4,
for either a successful or a thrown-responder turn; both terminate the wire sequence at
`session.waiting`. Any future task that needs true-terminal flush proof will require a
different harness (e.g. driving the dev server directly and forcing a hard `session.failed`
via a channel-level API, if one exists) rather than `eve eval`.

#### M0 script hygiene (Step 6b, carry-forward 6a/6b)

`scripts/m0/verify-live.mjs`'s `DUMP_DIR` constant was a baked, session-specific absolute
path (`/private/tmp/claude-501/-Users-chris-dev-oss-eve-studio/363c5e40-.../scratchpad`,
dead outside the session that created it). Replaced with
`process.env.M0_SCRATCH_DIR ?? "/tmp/eve-studio-m0"`, plus `mkdirSync(DUMP_DIR, { recursive:
true })` so the directory is created if missing (the old path relied on the scratchpad
already existing). Verified with `node --check scripts/m0/verify-live.mjs` (exit 0) only —
per the brief, the paid verify script itself was NOT re-run; these scripts are archival
evidence generators, not regression tests.

Port-cleanup note: the existing `lsof -ti tcp:${PORT} -sTCP:LISTEN | xargs kill` pattern in
`verify-live.mjs` (and used throughout Task 2's manual collector kills) is macOS-shaped —
`xargs -r` (skip invocation when stdin is empty) is a GNU coreutils flag not available in
macOS's BSD `xargs`, so these snippets rely on empty-stdin `xargs kill` being a harmless
no-op (true on macOS; NOT guaranteed portable). If these scripts ever move to Linux CI,
guard with an explicit non-empty check (e.g. `PIDS=$(lsof -ti ...); [ -n "$PIDS" ] && kill
$PIDS`) rather than assuming bare `xargs kill` no-ops safely.

#### Fresh `.workflow-data/` layout notes (Step 7, for Task 6)

`examples/demo-agent/.workflow-data/` is **not exclusively fresh** — it accumulates runs
across every prior M0/Plan-A/Plan-B task in this repo (7+ prior `wrun_*` directories already
present before this task's run). Task 6 must identify its own run by sessionId, not assume
an empty directory. **This task's own Step 6 throw-probe also added a second, unrelated run**
(`wrun_01KX5ZB772CGE00SXN4T40THQK`, the forced-failure session) to the same
`.workflow-data/`; Task 6 should use **`wrun_01KX5Z8EX40R4X8BMR4Z26X5Q9`** (the Step 3
two-turn mock-probe session, matching the committed fixture) as its copy source, not the
throw-probe session. Layout observed for this task's own session
(`wrun_01KX5Z8EX40R4X8BMR4Z26X5Q9`):

- **Manifest path pattern:** `streams/runs/<sessionId>.json` (literally
  `streams/runs/wrun_01KX5Z8EX40R4X8BMR4Z26X5Q9.json`). Contents:
  `{"streams": ["strm_01KX5Z8EX40R4X8BMR4Z26X5Q9_user"]}` — a flat list of stream ids owned
  by this run. **The manifest does not restate the sessionId as its own field**; the
  sessionId is only recoverable (a) from the manifest's own filename, or (b) by decoding the
  `session.started` chunk's `type` (indirectly — that chunk doesn't carry the sessionId
  either; the durable-store layer is the source of truth for the session↔stream mapping,
  not the payload).
- **Stream/chunk naming:** the stream id embedding the same ULID as the run id, with a
  `_user` suffix and `strm_` prefix instead of `wrun_`
  (`wrun_01KX5Z8EX40R4X8BMR4Z26X5Q9` ↔ `strm_01KX5Z8EX40R4X8BMR4Z26X5Q9_user`) — i.e. the
  sessionId's ULID portion is shared verbatim between the run manifest name and its stream's
  chunk-directory name; only the prefix/suffix differ. This is the practical way Task 6
  correlates a captured envelope's `sessionId` (`wrun_...`) to its on-disk chunk directory
  (`strm_..._user`): strip `wrun_`, prepend `strm_`, append `_user`.
- **Chunk directory/file naming:** `streams/chunks/<streamId>/<chnk_ULID>.bin` — one `.bin`
  file per event, e.g.
  `streams/chunks/strm_01KX5Z8EX40R4X8BMR4Z26X5Q9_user/chnk_01KX5Z8EZYMM7JXMZWDQW2XCTE.bin`.
- **Chunk order:** determined by **filename sort** (ULIDs are lexicographically sortable and
  monotonically increasing, so `readdirSync(...).sort()` yields chronological order).
  Verified empirically: decoded all 17 chunks for this run, and the filename-sorted order's
  event `type` sequence and each chunk's own `meta.at` timestamp were both monotonically
  increasing and matched the fixture's `seq` order exactly (chunk N's `meta.at` <= chunk
  N+1's `meta.at` for all 17 chunks, first chunk 12:15:25.171Z, last chunk 12:15:25.400Z).
  The manifest itself carries no per-chunk ordering field — order is filename-derived only.
- **Chunk↔event correspondence:** **1:1 for this run** — 17 `.bin` files in the chunk
  directory, 17 envelopes in the flattened fixture, and the decoded `type` sequence of the
  17 chunks matches the fixture's `event.type` sequence exactly, position for position.
- **Chunk encoding:** each `.bin` file is a small binary header (`devl` magic +
  devalue-tagged `["Uint8Array", 1]` array wrapper) followed by a base64-encoded JSON string
  payload, newline-terminated. The base64 payload decodes to
  `{"data": {...}, "type": "<event.type>", "meta": {"at": "<ISO-8601 timestamp>"}}` — i.e.
  the **persisted** chunk DOES carry `meta.at` (unlike the M0 Task 2 finding that the live
  wildcard-hook event object lacks a reachable `meta.at`; the durable store stamps it before
  or during persistence, independent of what the hook receives at fire time).
- **One full decoded chunk, verbatim** (first chunk,
  `chnk_01KX5Z8EZYMM7JXMZWDQW2XCTE.bin`, decoded payload):
  ```json
  {"data":{"runtime":{"agentId":"demo-agent","agentName":"demo-agent","eveVersion":"0.22.4","modelId":"eve-mock/model"}},"type":"session.started","meta":{"at":"2026-07-10T12:15:25.171Z"}}
  ```
- `.workflow-data` was **not deleted** — left in place per the brief, for Task 6 to copy
  from.

### Task 5: Server-side reduced conversation via eve's `defaultMessageReducer`

Run date: 2026-07-10. Step 4 required probing whether `defaultMessageReducer` (from
`eve/client`, eve 0.22.4) tolerates a context-free bare `message.appended` stream — the
shape Task 3's byte-cap eviction test feeds it (10 synthetic `message.appended` events with
no preceding `session.started`/`message.received`/`turn.started` prefix) — before trusting
that test would still pass once reduction was wired into `accept()`.

**Probe script** (`packages/studio/probe.mjs`, run via `node probe.mjs` from
`packages/studio` so `eve/client` resolves through the workspace's `node_modules`, then
deleted after recording the result):

```js
import { defaultMessageReducer } from "eve/client";
const reducer = defaultMessageReducer();
let state = reducer.initial();
const bareEvent = { type: "message.appended", data: { messageDelta: "x".repeat(500) } };
for (let i = 0; i < 10; i++) state = reducer.reduce(state, bareEvent);
```

**Result: no throw.** The reducer tolerated 10 consecutive bare `message.appended` events
with no session/turn/message-received context, producing a single in-progress assistant
message part:

```json
{"messages":[{"id":"undefined:assistant","metadata":{"status":"streaming"},"parts":[{"state":"streaming","type":"text"}],"role":"assistant"}]}
```

**Consequence: Task 3's eviction test needed NO change.** The brief's "if it throws" branch
(open Task 3's eviction test with a valid `session.started`/`message.received` prefix) did
not fire — `packages/studio/test/registry.test.ts`'s existing byte-cap eviction test is
untouched, and it stays as the coverage for the *non*-rebase, non-dead-reducer eviction path
(genuine contiguous unreduced run under the cap, evicted the old way since Task 5's
`reducedUpTo` progresses normally without ever stalling in that test — no
`session.started`/prefix gap exists there in the first place).

**Fixture-size finding, driving Task 5's own eviction-test cap lower than Task 3's:**
summing `JSON.stringify(event).length` (the exact metric `accept()`/`evictIfNeeded` use) over
all 17 events in the committed fixture (`packages/studio/test/fixtures/mock-eval-envelopes.ndjson`)
totals **1,814 bytes** — under the 2,000-byte cap the brief's Step 1 test snippet uses for
"never evicts unreduced events." Since eviction in `evictIfNeeded` triggers on
`rec.bytes > maxSessionBytes` (strict), a 2,000-byte cap against a 1,814-byte fixture would
never evict, defeating that test's own assertion (`evictedBelow > 0`). Per the brief's
explicit instruction ("if the two-turn capture came out smaller, lower those caps rather
than letting the tests pass without evicting anything"), that one test's cap was lowered to
1,000 bytes; the cap-pressure rebase test's cap (2,000 bytes against ~5,000+ bytes of
synthetic 500-byte-delta events) already exceeds the fixture comfortably and was left at the
brief's original value.

### Task 8: End-to-end smoke — eval → extension → real Studio, plus disk rediscovery

Run date: 2026-07-10. `pnpm smoke:studio` from repo root (builds `packages/studio` via `tsc`
first, then `node scripts/smoke-studio.mjs`). **mockModel-only run: `EVE_STUDIO_MOCK=1` was
set and `OPENROUTER_API_KEY` was deleted from the child env before either phase spawned — no
OpenRouter traffic was possible.** Port 43119 (dedicated smoke port, distinct from 43110/43117/
43118 used by prior tasks) verified free both before (nothing listening) and after the run
(`lsof -ti tcp:43119 -sTCP:LISTEN` → empty). `scripts/smoke-studio.mjs` is verbatim from the
brief — no adaptation was needed; the demo-agent's `@eve-studio/extension` mount, the
`mock-probe` eval, and `--scan-disk` all matched the brief's assumptions exactly on the first
run.

### Smoke output (verbatim, exit 0, all 11/11 checks true)

```json
{
  "evalExitZero": true,
  "oneSession": true,
  "statusTurnBoundary": true,
  "stepsCounted": true,
  "contiguousFromZero": true,
  "noReducerError": true,
  "reducedFirstTurn": true,
  "reducedSecondTurn": true,
  "noMessageSoFarLeak": true,
  "diskRediscovery": true,
  "noDiskMessageSoFarLeak": true
}
```

Took one run to go green (re-run a second time to double-check determinism and port hygiene;
identical 11/11-true result both times, port 43119 confirmed free after each). `diskRediscovery`
genuinely passed — Task 6's sessionId-recovery scheme (`strm_<ULID>_user` dirname →
`wrun_<ULID>`) and 1:1 chunk↔event correspondence for mock runs held up end-to-end; no fix to
`disk-scan.ts` or the fixture assumptions was required.

**Scope note, same caveat as Task 7's `leakedSoFar`:** `noMessageSoFarLeak` and
`noDiskMessageSoFarLeak` are almost certainly **trivial passes** on this fixture, not
end-to-end proof the strip fired. The mock replies (`MOCK[1]: ping one`, `MOCK[2]: ping two`)
are short — per Task 7's finding, eve does not emit a `messageSoFar` field on such short
`message.appended` deltas, so there is nothing on the wire for `buildEnvelope`'s strip (or the
disk-scan path's equivalent strip) to remove here. Both checks are correct and verbatim from
the brief; they just don't demonstrate the strip firing on real leaking data. The strip logic
itself remains verified at the unit level in `packages/extension/test/envelope.test.ts`
("strips messageSoFar from message.appended"), same as noted for Task 7.

## Plan C

### Task 7 — smoke with UI checks (evidence of record)

`pnpm smoke:studio` — 15/15 checks true (11 Plan B + uiHtmlServed, uiShellBranded,
uiAssetServed, healthEveVersion). Run date 2026-07-10, HEAD `5e0f7cb` (pre-Task-7). The 4 UI
checks were inserted verbatim from the Task 7 brief immediately after `noMessageSoFarLeak`,
still inside Phase 1. `pnpm smoke:studio` builds the UI (`vite build`, SPA mode with
prerendered `/`) and the studio package first, copies `packages/ui/dist/client` into
`packages/studio/dist/ui` via `scripts/copy-ui.mjs`, then runs the smoke against the real
built CLI (`packages/studio/dist/cli.js`). Ran twice to confirm determinism and port hygiene;
identical 15/15-true result both times, `lsof -ti tcp:43119 -sTCP:LISTEN` empty after each run.
Exit code 0 both times.

```json
{
  "evalExitZero": true,
  "oneSession": true,
  "statusTurnBoundary": true,
  "stepsCounted": true,
  "contiguousFromZero": true,
  "noReducerError": true,
  "reducedFirstTurn": true,
  "reducedSecondTurn": true,
  "noMessageSoFarLeak": true,
  "uiHtmlServed": true,
  "uiShellBranded": true,
  "uiAssetServed": true,
  "healthEveVersion": true,
  "diskRediscovery": true,
  "noDiskMessageSoFarLeak": true
}
```

No adaptation of the brief's 4-check snippet was needed. `uiShellBranded` passed against the
TanStack Start `<title>Eve Studio</title>` set in `packages/ui/src/routes/__root.tsx`;
`uiAssetServed` matched the first `/assets/...` reference in the prerendered shell HTML
(a hashed JS or CSS bundle path) and fetched it successfully from the collector's static
serving (Task 6); `healthEveVersion` confirmed `/health` reports the bundled `eve` version
(`0.22.4`) that `packages/studio`'s `package.json` pins.
