import { existsSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

function usesPnp(projectRoot: string): boolean {
  let directory = projectRoot;
  while (true) {
    if (existsSync(join(directory, ".pnp.cjs")) || existsSync(join(directory, ".pnp.loader.mjs"))) {
      return true;
    }
    const parent = dirname(directory);
    if (parent === directory) return false;
    directory = parent;
  }
}

function projectNodeModulesPaths(projectRoot: string): Set<string> {
  const paths = new Set<string>();
  let directory = projectRoot;
  while (true) {
    paths.add(join(directory, "node_modules"));
    const parent = dirname(directory);
    if (parent === directory) return paths;
    directory = parent;
  }
}

function isVisibleNodeModulesManifest(
  projectRoot: string,
  manifestPath: string,
  searchPaths: string[] | null,
): boolean {
  if (!searchPaths) return false;
  const projectPaths = projectNodeModulesPaths(projectRoot);
  const resolvedManifest = realpathSync(manifestPath);
  return searchPaths.some((searchPath) => {
    if (!projectPaths.has(searchPath)) return false;
    const candidate = join(searchPath, "eve", "package.json");
    try {
      return realpathSync(candidate) === resolvedManifest;
    } catch {
      return false;
    }
  });
}

/** Reads the INSTALLED eve version, never the package.json range (pnpm catalog: ranges are unreadable). */
export function installedEveVersion(projectRoot: string): string | undefined {
  try {
    const projectRequire = createRequire(join(projectRoot, "package.json"));
    const manifestPath = projectRequire.resolve("eve/package.json");
    const searchPaths = projectRequire.resolve.paths("eve/package.json");
    if (!isVisibleNodeModulesManifest(projectRoot, manifestPath, searchPaths) && !usesPnp(projectRoot)) return undefined;
    const pkg = JSON.parse(readFileSync(manifestPath, "utf8"));
    return typeof pkg.version === "string" ? pkg.version : undefined;
  } catch {
    return undefined;
  }
}

export const SUPPORTED_EVE_RANGE = ">=0.22.3 <0.23.0";

function parseStableVersion(version: string): [number, number, number] | undefined {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version);
  if (!match) return undefined;
  const parsed: [number, number, number] = [Number(match[1]), Number(match[2]), Number(match[3])];
  return parsed.every(Number.isSafeInteger) ? parsed : undefined;
}

export function supportsEveVersion(version: string): boolean {
  const parsed = parseStableVersion(version);
  if (!parsed) return false;
  const [major, minor, patch] = parsed;
  return major === 0 && minor === 22 && patch >= 3;
}
