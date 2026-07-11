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

function parseVersion(v: string): [number, number, number] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

export function meetsMinimum(version: string, minimum = "0.22.3"): boolean {
  const a = parseVersion(version);
  const b = parseVersion(minimum);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return true;
}
