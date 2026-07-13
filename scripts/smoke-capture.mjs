// E2E: eve eval (ephemeral server) -> @eve-studio/extension forwarder -> collector.
// Asserts: contiguous seq per session, turn-boundary event present, messageSoFar stripped.
//
// AMENDMENT (user-approved at the M0 gate): M0 proved a single-turn `eve eval` parks at
// `session.waiting` and NEVER emits `session.completed`/`result.completed`/`session.failed`
// (scripts/m0/DEVIATIONS.md, "Task 4"). The brief's `hasTerminal` assertion would therefore
// always fail on this path. Replaced with a turn-boundary assertion that includes
// `session.waiting` alongside the three true terminals, matching the forwarder's
// FLUSH_EVENTS set (Task 6).
import { spawn } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { once } from "node:events";

const CFILE = "/tmp/eve-studio-smoke-capture.ndjson";
const DEMO = new URL("../apps/demo-agent", import.meta.url).pathname;
rmSync(CFILE, { force: true });
rmSync(`${DEMO}/.workflow-data`, { recursive: true, force: true });

const collector = spawn("node", ["scripts/m0/collector.mjs"], {
  env: { ...process.env, M0_COLLECTOR_FILE: CFILE },
  stdio: "inherit",
});
await new Promise((r) => setTimeout(r, 500));

const evalEnv = { ...process.env, EVE_STUDIO_MOCK: "1" };
for (const key of [
  "OPENROUTER_API_KEY",
  "DEMO_MODEL",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "AI_GATEWAY_API_KEY",
]) {
  delete evalEnv[key];
}

const evalRun = spawn("pnpm", ["exec", "eve", "eval", "mock-probe", "--verbose"], {
  cwd: DEMO,
  env: { ...evalEnv, EVE_STUDIO_PORT: "43118" },
  stdio: "inherit",
});
const [code] = await once(evalRun, "exit");
collector.kill();

const batches = readFileSync(CFILE, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
const envelopes = batches.flatMap((b) => b.events);
const bySession = Map.groupBy(envelopes, (e) => e.sessionId);

let ok = code === 0 && bySession.size > 0;
for (const [sid, list] of bySession) {
  const seqs = list.map((e) => e.seq).sort((a, b) => a - b);
  const contiguous = seqs.every((s, i) => s === i);
  const hasTurnBoundary = list.some((e) =>
    ["session.completed", "result.completed", "session.failed", "session.waiting"].includes(e.event.type),
  );
  const leakedSoFar = list.some((e) => e.event?.data?.messageSoFar !== undefined);
  console.log(JSON.stringify({ sid, events: list.length, contiguous, hasTurnBoundary, leakedSoFar }));
  ok &&= contiguous && hasTurnBoundary && !leakedSoFar;
}
process.exit(ok ? 0 : 1);
