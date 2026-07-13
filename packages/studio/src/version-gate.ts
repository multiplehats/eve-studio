import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Reads the INSTALLED eve version, never the package.json range (pnpm catalog: ranges are unreadable). */
export function installedEveVersion(projectRoot: string): string | undefined {
  try {
    const pkg = JSON.parse(readFileSync(join(projectRoot, "node_modules", "eve", "package.json"), "utf8"));
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
