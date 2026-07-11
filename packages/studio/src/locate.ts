import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", ".workflow-data", ".eve", ".superpowers"]);

function isAgentProject(dir: string): boolean {
  return existsSync(join(dir, "agent", "agent.ts"));
}

export function findAgentProjects(root: string, maxDepth = 3): string[] {
  const found: string[] = [];
  function walk(dir: string, depth: number): void {
    if (isAgentProject(dir)) found.push(dir);
    if (depth >= maxDepth) return;
    let entries: string[];
    try { entries = readdirSync(dir); } catch { return; }
    for (const name of entries) {
      if (SKIP_DIRS.has(name) || name.startsWith(".")) continue;
      const child = join(dir, name);
      try { if (statSync(child).isDirectory()) walk(child, depth + 1); } catch { /* unreadable entry */ }
    }
  }
  walk(root, 0);
  return found;
}
