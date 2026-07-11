#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { createStudioProgram, type StudioCliOptions } from "./cli-program.js";
import { applyDiskScan } from "./disk-scan.js";
import { findAgentProjects } from "./locate.js";
import { detectPackageManager, isExtensionMounted, mountInstructions, scaffoldMount } from "./mount.js";
import { createRegistry } from "./registry.js";
import { startStudioServer } from "./server.js";
import { installedEveVersion, meetsMinimum } from "./version-gate.js";

const args = createStudioProgram().parse().opts<StudioCliOptions>();
const port = args.port !== undefined ? Number(args.port) : 43110;
function die(msg: string): never { console.error(`eve-studio: ${msg}`); process.exit(1); }
if (!Number.isInteger(port) || port < 0 || port > 65535) die(`invalid --port ${args.port}`);

async function confirm(question: string): Promise<boolean> {
  if (args.yes) return true;
  if (!process.stdin.isTTY || !process.stdout.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(`${question} [Y/n] `)).trim().toLowerCase();
  rl.close();
  return answer === "" || answer === "y" || answer === "yes";
}

async function resolveProject(): Promise<string> {
  if (args.project) return args.project;
  const candidates = findAgentProjects(process.cwd());
  if (candidates.length === 0) {
    die("no Eve agent project found (looked for agent/agent.ts up to 3 levels deep); run inside your Eve project or pass --project");
  }
  if (candidates.length === 1) return candidates[0];
  if (!process.stdin.isTTY) {
    die(`multiple agent projects found, pass --project:\n${candidates.map((c) => `  ${c}`).join("\n")}`);
  }
  candidates.forEach((c, i) => console.log(`  ${i + 1}. ${c}`));
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const picked = Number((await rl.question(`Which project? [1-${candidates.length}] `)).trim());
  rl.close();
  if (!Number.isInteger(picked) || picked < 1 || picked > candidates.length) die("invalid selection");
  return candidates[picked - 1];
}

const project = await resolveProject();

const eveVersion = installedEveVersion(project);
if (eveVersion === undefined) die(`eve is not installed in ${project}. Run your package manager's install first.`);
if (!meetsMinimum(eveVersion)) {
  die(`eve-studio needs eve >= 0.22.3 (found ${eveVersion}). Upgrade: ${detectPackageManager(project)} add eve@latest`);
}

if (!isExtensionMounted(project)) {
  if (await confirm(`Mount @eve-studio/extension into ${project}?`)) {
    let mountFile: string | undefined;
    try {
      const result = scaffoldMount(project);
      mountFile = result.mountFile;
      console.log(`eve-studio: wrote ${mountFile}`);
      const r = spawnSync(result.command[0], result.command.slice(1), { cwd: project, stdio: "inherit" });
      if (r.status !== 0) throw new Error(`${result.command.join(" ")} exited ${r.status}`);
    } catch (err) {
      if (mountFile) {
        rmSync(mountFile, { force: true });
        console.error(`eve-studio: removed ${mountFile}. Recreate it after the install succeeds (steps below).`);
      }
      console.error(`eve-studio: mount failed (${err instanceof Error ? err.message : err}); continuing without it`);
      console.error(mountInstructions(project));
    }
  } else {
    console.log(mountInstructions(project));
  }
}

const registry = createRegistry();
if (args.scanDisk) {
  const { sessions } = applyDiskScan(registry, project);
  console.log(`eve-studio: discovered ${sessions.length} session(s) from .workflow-data`);
}

try {
  const studioPkg = createRequire(import.meta.url)("../package.json") as {
    version: string; dependencies: Record<string, string>;
  };
  const uiDir = fileURLToPath(new URL("./ui", import.meta.url));
  const hasUi = existsSync(join(uiDir, "_shell.html"));
  const server = await startStudioServer({
    registry, port,
    meta: { studioVersion: studioPkg.version, eveVersion: studioPkg.dependencies.eve },
    staticDir: hasUi ? uiDir : undefined,
  });
  console.log(`eve-studio: listening on ${server.url}`);
  if (hasUi) console.log(`eve-studio: open ${server.url} in your browser`);
  else console.log(`eve-studio: UI assets not bundled; sessions snapshot at ${server.url}/api/sessions`);
  const shutdown = () => { void server.close().then(() => process.exit(0)); };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
} catch (err) {
  if ((err as NodeJS.ErrnoException).code === "EADDRINUSE") {
    die(`port ${port} is taken, most likely by another eve-studio. Stop it or rerun with --port <n> AND set EVE_STUDIO_PORT=<n> in the agent's environment so the extension forwards to the same port.`);
  }
  throw err;
}
