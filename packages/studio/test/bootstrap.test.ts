import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findAgentProjects } from "../src/locate.js";
import { installedEveVersion, SUPPORTED_EVE_RANGE, supportsEveVersion } from "../src/version-gate.js";
import { createdMountFile, detectPackageManager, isExtensionMounted, scaffoldMount } from "../src/mount.js";

function tmp(): string { return mkdtempSync(join(tmpdir(), "eve-studio-cli-")); }
function makeAgentProject(root: string, rel = "."): string {
  const p = join(root, rel);
  mkdirSync(join(p, "agent"), { recursive: true });
  writeFileSync(join(p, "agent", "agent.ts"), "export default {}\n");
  writeFileSync(join(p, "package.json"), JSON.stringify({ name: "fixture", dependencies: {} }));
  return p;
}

describe("findAgentProjects", () => {
  it("finds cwd itself, nested projects (2 deep), and skips node_modules", () => {
    const root = tmp();
    makeAgentProject(root);
    makeAgentProject(root, "agents/assistant");            // the auttendo shape
    makeAgentProject(root, "node_modules/evil");
    const found = findAgentProjects(root);
    expect(found).toContain(root);
    expect(found).toContain(join(root, "agents/assistant"));
    expect(found.some((p) => p.includes("node_modules"))).toBe(false);
  });
  it("empty dir -> []", () => expect(findAgentProjects(tmp())).toEqual([]));
});

describe("version gate", () => {
  it("reads the installed version, not the package.json range", () => {
    const p = makeAgentProject(tmp());
    mkdirSync(join(p, "node_modules", "eve"), { recursive: true });
    writeFileSync(join(p, "node_modules", "eve", "package.json"), JSON.stringify({ name: "eve", version: "0.22.4" }));
    expect(installedEveVersion(p)).toBe("0.22.4");
    expect(installedEveVersion(makeAgentProject(tmp()))).toBeUndefined();
  });
  it("accepts only stable Eve releases in the supported compatibility window", () => {
    expect(SUPPORTED_EVE_RANGE).toBe(">=0.22.3 <0.23.0");
    expect(supportsEveVersion("0.22.3")).toBe(true);
    expect(supportsEveVersion("0.22.4")).toBe(true);
    expect(supportsEveVersion("0.22.99")).toBe(true);
    expect(supportsEveVersion("0.22.2")).toBe(false);
    expect(supportsEveVersion("0.17.2")).toBe(false);
    expect(supportsEveVersion("0.23.0")).toBe(false);
    expect(supportsEveVersion("1.0.0")).toBe(false);
    expect(supportsEveVersion("0.22.4-beta.1")).toBe(false);
    expect(supportsEveVersion("0.22.4+build.1")).toBe(false);
    expect(supportsEveVersion(" 0.22.4 ")).toBe(false);
    expect(supportsEveVersion("0.22.999999999999999999999")).toBe(false);
    expect(supportsEveVersion("garbage")).toBe(false);
  });
});

describe("mount", () => {
  it("detects a mounted project only when BOTH the dep and the mount file exist", () => {
    const p = makeAgentProject(tmp());
    expect(isExtensionMounted(p)).toBe(false);
    writeFileSync(join(p, "package.json"), JSON.stringify({ name: "f", dependencies: { "@eve-studio/extension": "^0.1.0" } }));
    expect(isExtensionMounted(p)).toBe(false);             // dep alone is not mounted
    mkdirSync(join(p, "agent", "extensions"), { recursive: true });
    writeFileSync(join(p, "agent", "extensions", "studio.ts"), 'export { default } from "@eve-studio/extension";\n');
    expect(isExtensionMounted(p)).toBe(true);
  });
  it("scaffoldMount writes the mount file and returns the right PM command", () => {
    const p = makeAgentProject(tmp());
    writeFileSync(join(p, "pnpm-lock.yaml"), "");
    expect(detectPackageManager(p)).toBe("pnpm");
    const { command, mountFile } = scaffoldMount(p);
    expect(command).toEqual(["pnpm", "add", "@eve-studio/extension"]);
    expect(mountFile).toBe(join(p, "agent", "extensions", "studio.ts"));
    expect(isExtensionMounted(p)).toBe(false);             // dep not installed yet: caller spawns the command
  });

  it("creates a missing mount exclusively", () => {
    const p = makeAgentProject(tmp());

    expect(scaffoldMount(p)).toMatchObject({ kind: "ready", created: true });
  });

  it("reuses the exact generated mount without claiming ownership", () => {
    const p = makeAgentProject(tmp());
    const mountFile = join(p, "agent", "extensions", "studio.ts");
    mkdirSync(join(p, "agent", "extensions"), { recursive: true });
    writeFileSync(mountFile, 'export { default } from "@eve-studio/extension";\n');

    expect(scaffoldMount(p)).toMatchObject({ kind: "ready", mountFile, created: false });
  });

  it("returns a typed conflict and preserves an unrelated studio.ts", () => {
    const p = makeAgentProject(tmp());
    const mountFile = join(p, "agent", "extensions", "studio.ts");
    const userSource = 'export default { name: "my studio extension" };\n';
    mkdirSync(join(p, "agent", "extensions"), { recursive: true });
    writeFileSync(mountFile, userSource);

    expect(scaffoldMount(p)).toMatchObject({ kind: "conflict", mountFile });
    expect(readFileSync(mountFile, "utf8")).toBe(userSource);
  });

  it("only marks a mount created by this invocation as safe to roll back", () => {
    const createdProject = makeAgentProject(tmp());
    const created = scaffoldMount(createdProject);

    const existingProject = makeAgentProject(tmp());
    const existingMount = join(existingProject, "agent", "extensions", "studio.ts");
    mkdirSync(join(existingProject, "agent", "extensions"), { recursive: true });
    writeFileSync(existingMount, 'export { default } from "@eve-studio/extension";\n');
    const existing = scaffoldMount(existingProject);

    const conflictProject = makeAgentProject(tmp());
    const conflictMount = join(conflictProject, "agent", "extensions", "studio.ts");
    mkdirSync(join(conflictProject, "agent", "extensions"), { recursive: true });
    writeFileSync(conflictMount, "export default {};\n");
    const conflict = scaffoldMount(conflictProject);

    expect(createdMountFile(created)).toBe(join(createdProject, "agent", "extensions", "studio.ts"));
    expect(createdMountFile(existing)).toBeUndefined();
    expect(createdMountFile(conflict)).toBeUndefined();
  });
});
