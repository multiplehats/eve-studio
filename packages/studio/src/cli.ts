#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { createStudioProgram, invalidStudioPortMessage, parseStudioPort, type StudioCliOptions } from "./cli-program.js";
import { applyDiskScan } from "./disk-scan.js";
import { findAgentProjects } from "./locate.js";
import {
  createdMountFile,
  detectPackageManager,
  isExtensionMounted,
  mountInstructions,
  removeGeneratedMountFile,
  scaffoldMount,
} from "./mount.js";
import { createRegistry } from "./registry.js";
import { startStudioServer } from "./server.js";
import { installedEveVersion, SUPPORTED_EVE_RANGE, supportsEveVersion } from "./version-gate.js";

const args = createStudioProgram().parse().opts<StudioCliOptions>();
function die(msg: string): never { console.error(`eve-studio: ${msg}`); process.exit(1); }
const port = parseStudioPort(args.port);
if (port === undefined) die(invalidStudioPortMessage(args.port));

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
if (!supportsEveVersion(eveVersion)) {
  die(`eve-studio supports eve ${SUPPORTED_EVE_RANGE} (found ${eveVersion}). Install a compatible version: ${detectPackageManager(project)} add eve@^0.22.3`);
}

if (!isExtensionMounted(project)) {
  if (await confirm(`Mount @eve-studio/extension into ${project}?`)) {
    let rollbackFile: string | undefined;
    try {
      const result = scaffoldMount(project);
      if (result.kind === "conflict") {
        console.error(`eve-studio: ${result.mountFile} already exists with different content; left it unchanged`);
        console.error(mountInstructions(project));
      } else {
        rollbackFile = createdMountFile(result);
        console.log(`eve-studio: ${result.created ? "wrote" : "using"} ${result.mountFile}`);
        const r = spawnSync(result.command[0], result.command.slice(1), { cwd: project, stdio: "inherit" });
        if (r.status !== 0) throw new Error(`${result.command.join(" ")} exited ${r.status}`);
      }
    } catch (err) {
      if (rollbackFile) {
        if (removeGeneratedMountFile(rollbackFile)) {
          console.error(`eve-studio: removed ${rollbackFile}. Recreate it after the install succeeds (steps below).`);
        } else if (existsSync(rollbackFile)) {
          console.error(`eve-studio: kept ${rollbackFile} because it changed while the install was running.`);
        }
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
