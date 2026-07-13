import { randomUUID } from "node:crypto";
import { defineHook } from "eve/hooks";
import { parseStudioPort, projectNameFromRoot, projectRootDigest } from "../lib/config.js";
import { buildEnvelope, isInert, type EnvelopeState } from "../lib/envelope.js";
import { Forwarder } from "../lib/forwarder.js";

// Amendment (M0 gate): a single-turn `eve eval` parks the session at
// `session.waiting` and NEVER emits `session.completed` / `session.failed` /
// `result.completed` (M0-d, scripts/m0/DEVIATIONS.md "Task 4"). A flush keyed
// only on the three true terminals would lose the whole eval turn when the
// ephemeral server closes. `session.waiting` is added as a bounded-flush
// trigger; it is not necessarily a session terminal.
const FLUSH_EVENTS = new Set(["session.completed", "session.failed", "result.completed", "session.waiting"]);
const port = parseStudioPort(process.env.EVE_STUDIO_PORT);
const forwarder = port === undefined ? undefined : new Forwarder({ url: `http://127.0.0.1:${port}` });
const INERT = isInert(process.env) || forwarder === undefined;
const state: EnvelopeState = {
  counters: new Map(),
  hookEpoch: randomUUID(),
  project: { name: safeProjectName(), root: safeRootHash() },
  // Plan A proved argv sniffing is doubly unreliable (reports "dev" under
  // `eve eval`; matches project paths containing "dev"). kind is now an
  // explicit, optional signal set by whoever launches eve (e.g. iterate-eve
  // exports EVE_STUDIO_KIND=eval). Display-only: consumers never branch on it.
  processInfo: { instanceId: randomUUID(), kind: process.env.EVE_STUDIO_KIND ?? "unknown", pid: process.pid },
  group: process.env.EVE_STUDIO_GROUP,
};

function safeProjectName(): string {
  try {
    // cwd of the compiled agent process is the agent project root
    return process.env.npm_package_name ?? projectNameFromRoot(process.cwd());
  } catch {
    return "unknown";
  }
}
function safeRootHash(): string {
  try {
    return projectRootDigest(process.cwd());
  } catch {
    return "unknown";
  }
}

export default defineHook({
  events: {
    "*": async (event, ctx) => {
      if (INERT || !forwarder) return;
      try {
        forwarder.push(buildEnvelope(event as { type: string; data?: unknown }, ctx, state));
        if (FLUSH_EVENTS.has((event as { type: string }).type)) {
          await forwarder.flushTerminal();
        }
      } catch {
        /* never throw into the turn path */
      }
    },
  },
});
