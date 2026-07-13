import { createHash } from "node:crypto";

export const DEFAULT_STUDIO_PORT = 43110;

export function parseStudioPort(value: string | undefined): number | undefined {
  if (value === undefined) return DEFAULT_STUDIO_PORT;
  if (!/^[0-9]+$/.test(value)) return undefined;

  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) return undefined;
  return port;
}

export function projectRootDigest(root: string): string {
  return createHash("sha256").update(root).digest("hex").slice(0, 12);
}

export function projectNameFromRoot(root: string): string {
  return root.replace(/[\\/]+$/, "").split(/[\\/]/).at(-1) || "unknown";
}
