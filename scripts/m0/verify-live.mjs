// M0-a: does the extension-contributed wildcard hook observe a session identically
// to the durable stream? M0-c: do wire events carry a stable id (ULID)?
import { spawn, execSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync, readdirSync, statSync, mkdirSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

const PORT = 43117;
const PROBE = "/tmp/eve-studio-m0-live.ndjson";
const BASE = `http://127.0.0.1:${PORT}`;
// Non-fatal artifact dump so the two required observations can be done off ONE paid run.
const DUMP_DIR = process.env.M0_SCRATCH_DIR ?? "/tmp/eve-studio-m0";
mkdirSync(DUMP_DIR, { recursive: true });
const EVENTS_DIR = new URL("../../examples/demo-agent/.workflow-data/events", import.meta.url).pathname;

// Optional, non-gate: snapshot the .workflow-data events dir (name -> mtimeMs) so we can
// tell which event files appeared *during* our turn and whether writes were real-time.
function snapshotEventsDir() {
  try {
    const out = {};
    for (const f of readdirSync(EVENTS_DIR)) {
      if (f.endsWith(".json")) out[f] = statSync(`${EVENTS_DIR}/${f}`).mtimeMs;
    }
    return out;
  } catch {
    return {};
  }
}

rmSync(PROBE, { force: true });
const server = spawn("pnpm", ["exec", "eve", "dev", "--no-ui", "--port", String(PORT)], {
  cwd: new URL("../../examples/demo-agent", import.meta.url).pathname,
  env: { ...process.env, EVE_STUDIO_PROBE_FILE: PROBE },
  stdio: "inherit",
});
try {
  for (let i = 0; i < 30; i++) {
    try { if ((await fetch(`${BASE}/eve/v1/health`)).ok) break; } catch {}
    await sleep(1000);
  }
  const before = snapshotEventsDir();
  const res = await fetch(`${BASE}/eve/v1/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: "Reply with exactly the word PONG and nothing else." }),
  });
  const { sessionId } = await res.json();
  await sleep(15_000); // let the turn complete

  // IMPORTANT: the stream endpoint live-follows — it never closes the connection
  // for a waiting session, so res.text() would hang forever. Drain NDJSON lines
  // with an idle timeout instead; going idle after the replay burst = replay done.
  const streamEvents = await readNdjsonUntilIdle(
    `${BASE}/eve/v1/session/${sessionId}/stream?startIndex=0`,
    { idleMs: 3000, totalMs: 20_000 },
  );
  const probeEvents = readFileSync(PROBE, "utf8").trim().split("\n").map((l) => JSON.parse(l))
    .filter((e) => e.sid === sessionId);
  const after = snapshotEventsDir();

  // --- Non-fatal artifact dump (does not affect gate) ---------------------------------
  try {
    writeFileSync(`${DUMP_DIR}/stream-events.json`, JSON.stringify(streamEvents, null, 2));
    writeFileSync(`${DUMP_DIR}/probe-events.json`, JSON.stringify(probeEvents, null, 2));
    const newFiles = Object.keys(after).filter((f) => !(f in before) || after[f] !== before[f]);
    writeFileSync(`${DUMP_DIR}/workflow-data-delta.json`, JSON.stringify({
      sessionId,
      newOrChangedFiles: newFiles.map((f) => ({ file: f, mtimeMs: after[f], mtimeIso: new Date(after[f]).toISOString() })),
    }, null, 2));
  } catch (e) {
    console.error("artifact dump failed (non-fatal):", e?.message);
  }

  const hookFired = probeEvents.length > 0;
  const orderMatchesStream =
    probeEvents.length === streamEvents.length &&
    probeEvents.every((p, i) => p.type === streamEvents[i].type);
  const seqAlignsWithStartIndex = probeEvents.every((p, i) => p.seq === i);
  // Look for any id-like field on the wire event (ULID starts "evnt_" per .workflow-data keys)
  const sample = JSON.stringify(streamEvents.concat(probeEvents.map((p) => p.raw)));
  const idMatch = sample.match(/"(\w*[iI]d|id)"\s*:\s*"(evnt_[A-Za-z0-9]+)"/);
  const eventIdField = idMatch ? idMatch[1] : null;

  const findings = { hookFired, orderMatchesStream, seqAlignsWithStartIndex, eventIdField };
  console.log(JSON.stringify(findings, null, 2));
  // Diagnostics printed only when a gate fails — never weaken the assertion, expose the diff.
  if (!hookFired || !orderMatchesStream || !seqAlignsWithStartIndex) {
    console.error("--- GATE FAIL DIAGNOSTICS ---");
    console.error("apiSessionId:", sessionId);
    console.error("probeEvents.length:", probeEvents.length, "streamEvents.length:", streamEvents.length);
    console.error("probe sids seen:", [...new Set(readFileSync(PROBE, "utf8").trim().split("\n").map((l) => JSON.parse(l).sid))]);
    console.error("probe types:", JSON.stringify(probeEvents.map((p) => p.type)));
    console.error("stream types:", JSON.stringify(streamEvents.map((e) => e.type)));
    process.exit(1);
  }
} finally {
  server.kill("SIGTERM");
  // The eve dev grandchild often survives the pnpm SIGTERM and keeps the port held.
  // Task requires killing by port; do it defensively and non-fatally.
  try {
    execSync(`lsof -ti tcp:${PORT} -sTCP:LISTEN | xargs kill 2>/dev/null`, { stdio: "ignore" });
  } catch { /* nothing listening = already clean */ }
}

async function readNdjsonUntilIdle(url, { idleMs, totalMs }) {
  const ctrl = new AbortController();
  const total = setTimeout(() => ctrl.abort(), totalMs);
  let idle = setTimeout(() => ctrl.abort(), idleMs);
  const lines = [];
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      clearTimeout(idle);
      idle = setTimeout(() => ctrl.abort(), idleMs);
      buf += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line) lines.push(JSON.parse(line));
      }
    }
  } catch (err) {
    if (!ctrl.signal.aborted) throw err; // abort = expected end of replay burst
  } finally {
    clearTimeout(total);
    clearTimeout(idle);
  }
  return lines;
}
