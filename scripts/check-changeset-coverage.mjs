import { existsSync, readdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

function run(args) {
  const result = spawnSync("git", args, { encoding: "utf8", stdio: "pipe" });
  if (result.status !== 0) return "";
  return result.stdout.trim();
}

const diffBase = run(["merge-base", "HEAD", "origin/main"]) || "origin/main";
const changed = run(["diff", "--name-only", `${diffBase}...HEAD`])
  .split("\n")
  .filter(Boolean);

const uiChanged = changed.some((file) => file.startsWith("packages/ui/"));
if (!uiChanged) {
  console.log("Changeset coverage check passed.");
  process.exit(0);
}

const changesetDir = ".changeset";
const changesets = existsSync(changesetDir)
  ? readdirSync(changesetDir).filter((file) => file.endsWith(".md") && file !== "README.md")
  : [];

const hasStudioChangeset = changesets.some((file) => {
  const text = readFileSync(join(changesetDir, file), "utf8");
  return text.includes('"eve-studio"') || text.includes("'eve-studio'");
});

if (!hasStudioChangeset) {
  console.error("packages/ui changed, but no changeset selects eve-studio.");
  console.error("Because @eve-studio/ui is bundled into the eve-studio CLI package, UI changes must release eve-studio.");
  process.exit(1);
}

console.log("Changeset coverage check passed.");
