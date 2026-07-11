import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const PKG = "@eve-studio/extension";

export function isExtensionMounted(projectRoot: string): boolean {
  try {
    const pkg = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8"));
    const hasDep = Boolean(pkg.dependencies?.[PKG] ?? pkg.devDependencies?.[PKG]);
    if (!hasDep) return false;
    const extDir = join(projectRoot, "agent", "extensions");
    if (!existsSync(extDir)) return false;
    return readdirSync(extDir).some((f) => f.endsWith(".ts") && readFileSync(join(extDir, f), "utf8").includes(PKG));
  } catch {
    return false;
  }
}

export function detectPackageManager(projectRoot: string): "pnpm" | "yarn" | "bun" | "npm" {
  let dir = projectRoot;
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, "pnpm-lock.yaml"))) return "pnpm";
    if (existsSync(join(dir, "yarn.lock"))) return "yarn";
    if (existsSync(join(dir, "bun.lockb")) || existsSync(join(dir, "bun.lock"))) return "bun";
    if (existsSync(join(dir, "package-lock.json"))) return "npm";
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return "npm";
}

export function scaffoldMount(projectRoot: string): { command: string[]; mountFile: string } {
  const pm = detectPackageManager(projectRoot);
  const command = pm === "npm" ? ["npm", "install", PKG] : [pm, "add", PKG];
  const mountFile = join(projectRoot, "agent", "extensions", "studio.ts");
  mkdirSync(dirname(mountFile), { recursive: true });
  writeFileSync(mountFile, `export { default } from "${PKG}";\n`);
  return { command, mountFile };
}

export function mountInstructions(projectRoot: string): string {
  const pm = detectPackageManager(projectRoot);
  const add = pm === "npm" ? "npm install" : `${pm} add`;
  return [
    `To capture live events, mount the Studio extension in ${projectRoot}:`,
    `  1. ${add} ${PKG}`,
    `  2. create agent/extensions/studio.ts containing:  export { default } from "${PKG}";`,
    `Sessions started before mounting are only visible via --scan-disk.`,
  ].join("\n");
}
