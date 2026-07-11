// M0-b: hooks fire in eve eval's ephemeral in-process server.
// M0-d: an awaited bounded flush on terminal events completes before p.close().
import { spawn } from "node:child_process";
import { readFileSync, rmSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { once } from "node:events";

const PROBE = "/tmp/eve-studio-m0-eval.ndjson";
const CFILE = "/tmp/eve-studio-m0-collector.ndjson";
const DEMO = new URL("../../apps/demo-agent", import.meta.url).pathname;
const EVENTS_DIR = join(DEMO, ".workflow-data/events");

rmSync(PROBE, { force: true });
rmSync(CFILE, { force: true });

// --- non-gating observation helper: snapshot .workflow-data/events ---
function snapshotEvents() {
  if (!existsSync(EVENTS_DIR)) return new Map();
  const m = new Map();
  for (const name of readdirSync(EVENTS_DIR)) {
    try {
      m.set(name, statSync(join(EVENTS_DIR, name)).mtimeMs);
    } catch {
      /* ignore */
    }
  }
  return m;
}
const before = snapshotEvents();

const collector = spawn("node", ["scripts/m0/collector.mjs"], {
  env: { ...process.env, M0_COLLECTOR_FILE: CFILE },
  stdio: "inherit",
});
await new Promise((r) => setTimeout(r, 500));

let code = null;
try {
  const evalRun = spawn("pnpm", ["exec", "eve", "eval", "m0-probe", "--verbose"], {
    cwd: DEMO,
    env: { ...process.env, EVE_STUDIO_PROBE_FILE: PROBE },
    stdio: "inherit",
  });
  [code] = await once(evalRun, "exit");
} finally {
  collector.kill();
}

// --- non-gating observation: .workflow-data under eve eval ---
const after = snapshotEvents();
const newFiles = [...after.keys()].filter((k) => !before.has(k));
const changedFiles = [...after.keys()].filter((k) => before.has(k) && after.get(k) !== before.get(k));
const wdObservation = {
  eventsDirExists: existsSync(EVENTS_DIR),
  filesBefore: before.size,
  filesAfter: after.size,
  newFileCount: newFiles.length,
  changedFileCount: changedFiles.length,
  newFiles: newFiles.slice(0, 20),
  // staggered mtimes => real-time writes; a single instant => flushed at close
  newFileMtimeSpreadMs:
    newFiles.length > 1
      ? Math.max(...newFiles.map((f) => after.get(f))) - Math.min(...newFiles.map((f) => after.get(f)))
      : null,
};

// --- gate findings (never weaken these) ---
let probe = [];
let collected = [];
try {
  probe = existsSync(PROBE)
    ? readFileSync(PROBE, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l))
    : [];
} catch {
  /* leave empty on parse failure */
}
try {
  collected = existsSync(CFILE)
    ? readFileSync(CFILE, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l))
    : [];
} catch {
  /* leave empty on parse failure */
}
const flushLines = probe.filter((e) => e.type === "__flush");
const waitingFlushLines = probe.filter((e) => e.type === "__waiting_flush");

const findings = {
  evalExitCode: code,
  evalHookFired: probe.some((e) => e.type === "session.started"),
  terminalEventSurvivedClose: collected.some(
    (e) => e.type === "session.completed" || e.type === "session.failed" || e.type === "result.completed",
  ),
  terminalFlushLatencyMs: flushLines.length ? Math.max(...flushLines.map((e) => e.ms)) : null,
};
console.log(JSON.stringify(findings, null, 2));

// --- non-gating: awaited-flush mechanism probe on session.waiting ---
// Single-turn eval parks at session.waiting and never emits a terminal event,
// so terminalFlushLatencyMs stays null / terminalEventSurvivedClose stays false
// as lifecycle facts. This pair answers whether an awaited hook flush lands
// before p.close() for the last inline-dispatched event. It is NOT proof that
// a hypothetical session.completed would survive (that event never fires here).
const waitingProbe = {
  waitingEventObserved: probe.some((e) => e.type === "session.waiting"),
  waitingFlushSurvivedClose: collected.some((e) => e.type === "session.waiting"),
  waitingFlushLatencyMs: waitingFlushLines.length
    ? Math.max(...waitingFlushLines.map((e) => e.ms))
    : null,
};
console.log("--- non-gating: awaited-flush mechanism probe (session.waiting) ---");
console.log(JSON.stringify(waitingProbe, null, 2));
console.log("--- non-gating: .workflow-data under eve eval ---");
console.log(JSON.stringify(wdObservation, null, 2));
console.log(`hookCapturedWireEvents=${probe.filter((e) => e.type !== "__flush").length}`);

if (!findings.evalHookFired || !findings.terminalEventSurvivedClose) process.exit(1);
