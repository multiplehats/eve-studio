// E2E: eve eval (mockModel, free) -> @eve-studio/extension -> REAL eve-studio server.
// Phase 1 (live): sessions API shows the session with ordered events, reduced text, no leaks.
// Phase 2 (disk): a fresh Studio with --scan-disk rediscovers the same session from .workflow-data.
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

// 43119, NOT 43110: a real eve-studio the user left running on the default port
// must never be mistaken for the smoke's server (the extension follows
// EVE_STUDIO_PORT, so capture pairs with the smoke's port automatically).
const PORT = 43119;
const BASE = `http://127.0.0.1:${PORT}`;
const DEMO = fileURLToPath(new URL("../apps/demo-agent", import.meta.url));
const CLI = fileURLToPath(new URL("../packages/studio/dist/cli.js", import.meta.url));
// The eve pin's single source of truth is packages/studio/package.json dependencies.eve.
const EVE_PIN = JSON.parse(readFileSync(fileURLToPath(new URL("../packages/studio/package.json", import.meta.url)), "utf8")).dependencies.eve;
const results = {};
let ok = true;
const check = (name, cond) => { results[name] = !!cond; ok &&= !!cond; };

const env = { ...process.env, EVE_STUDIO_MOCK: "1", EVE_STUDIO_PORT: String(PORT) };
delete env.OPENROUTER_API_KEY;                            // Global Constraint 2: paid calls impossible

async function waitHealthy(timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if ((await fetch(`${BASE}/health`)).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("studio never became healthy");
}
function startStudio(extraArgs = []) {
  return spawn("node", [CLI, "--project", DEMO, "--port", String(PORT), "--yes", ...extraArgs], { stdio: "inherit" });
}
async function stop(child) {
  child.kill("SIGTERM");
  await Promise.race([once(child, "exit"), new Promise((r) => setTimeout(r, 3_000))]);
  child.kill("SIGKILL");
}

// Fresh disk state so phase 2 provably rediscovers THIS run's session.
rmSync(`${DEMO}/.workflow-data`, { recursive: true, force: true });

// --- Phase 1: live capture into a running Studio ---
const studio = startStudio();
await waitHealthy();
const evalRun = spawn("pnpm", ["exec", "eve", "eval", "mock-probe", "--verbose"], { cwd: DEMO, env, stdio: "inherit" });
const [evalCode] = await once(evalRun, "exit");
check("evalExitZero", evalCode === 0);
await new Promise((r) => setTimeout(r, 750));             // > forwarder batchDelay; terminal flush is awaited anyway

const { sessions } = await (await fetch(`${BASE}/api/sessions`)).json();
check("oneSession", sessions.length === 1);
const s = sessions[0];
check("statusTurnBoundary", ["waiting", "completed", "failed"].includes(s.status) && s.status !== "failed");
check("stepsCounted", s.usage.steps >= 1);
const detail = await (await fetch(`${BASE}/api/sessions/${encodeURIComponent(s.sessionId)}`)).json();
const positions = detail.events.map((e) => e.position);
check("contiguousFromZero", positions.every((p, i) => p === i));
check("noReducerError", detail.reducerError === undefined);
const reducedText = JSON.stringify(detail.reducedState);
check("reducedFirstTurn", reducedText.includes("MOCK[1]: ping one"));
check("reducedSecondTurn", reducedText.includes("MOCK[2]: ping two"));
check("noMessageSoFarLeak", !detail.events.some((e) => e.event?.data?.messageSoFar !== undefined));

// --- UI (Plan C): the same collector serves the built SPA ---
const home = await fetch(`${BASE}/`);
check("uiHtmlServed", home.ok && (home.headers.get("content-type") ?? "").includes("text/html"));
const homeHtml = await home.text();
check("uiShellBranded", homeHtml.includes("Eve Studio"));
const assetPath = homeHtml.match(/(?:src|href)="(\/assets\/[^"]+)"/)?.[1];
check("uiAssetServed", assetPath !== undefined && (await fetch(`${BASE}${assetPath}`)).ok);
const directSession = await fetch(`${BASE}/sessions/${encodeURIComponent(s.sessionId)}`);
const directSessionHtml = await directSession.text();
check(
  "directSessionShellBranded",
  directSession.ok
    && (directSession.headers.get("content-type") ?? "").includes("text/html")
    && directSessionHtml.includes("Eve Studio"),
);
check("healthEveVersion", (await (await fetch(`${BASE}/health`)).json()).eveVersion === EVE_PIN);

const liveSessionId = s.sessionId;
await stop(studio);

// --- Phase 2: fresh Studio, no eval: disk scan must rediscover the session ---
const studio2 = startStudio(["--scan-disk"]);
await waitHealthy();
const snap2 = await (await fetch(`${BASE}/api/sessions`)).json();
check("diskRediscovery", snap2.sessions.some((x) => x.sessionId === liveSessionId));
const detail2 = await (await fetch(`${BASE}/api/sessions/${encodeURIComponent(liveSessionId)}`)).json();
check("noDiskMessageSoFarLeak", !detail2.events.some((e) => e.event?.data?.messageSoFar !== undefined));  // disk path strips too
await stop(studio2);

console.log(JSON.stringify(results, null, 2));
process.exit(ok ? 0 : 1);
