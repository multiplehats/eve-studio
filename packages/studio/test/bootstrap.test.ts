import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findAgentProjects } from "../src/locate.js";
import { installedEveVersion, meetsMinimum } from "../src/version-gate.js";
import { detectPackageManager, isExtensionMounted, scaffoldMount } from "../src/mount.js";

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
  it("compares numerically, not lexically", () => {
    expect(meetsMinimum("0.22.3")).toBe(true);
    expect(meetsMinimum("0.22.4")).toBe(true);
    expect(meetsMinimum("0.100.0")).toBe(true);            // lexical compare would fail this
    expect(meetsMinimum("0.22.2")).toBe(false);
    expect(meetsMinimum("0.17.2")).toBe(false);            // auttendo today
    expect(meetsMinimum("1.0.0")).toBe(true);
    expect(meetsMinimum("garbage")).toBe(false);
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
    expect(isExtensionMounted(p)).toBe(false);             // dep not installed yet — caller spawns the command
  });
});
