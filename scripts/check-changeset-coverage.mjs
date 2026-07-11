import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

function run(args) {
  const result = spawnSync("git", args, { encoding: "utf8", stdio: "pipe" });
  if (result.status !== 0) return "";
  return result.stdout.trim();
}

const diffBase = run(["merge-base", "HEAD", "origin/main"]) || "origin/main";
const changed = run(["diff", "--name-only", `${diffBase}...HEAD`])
  .split("\n")
  .filter(Boolean);
const changedChangesets = run(["diff", "--name-only", "--diff-filter=AM", `${diffBase}...HEAD`, "--", ".changeset"])
  .split("\n")
  .filter(Boolean);

const uiChanged = changed.some((file) => file.startsWith("packages/ui/"));
if (!uiChanged) {
  console.log("Changeset coverage check passed.");
  process.exit(0);
}

const changesets = changedChangesets.filter(
  (file) => file.startsWith(".changeset/") && file.endsWith(".md") && file !== ".changeset/README.md",
);

const hasStudioChangeset = changesets.some((file) => {
  const text = readFileSync(file, "utf8");
  return text.includes('"eve-studio"') || text.includes("'eve-studio'");
});

if (!hasStudioChangeset) {
  console.error("packages/ui changed, but no changeset selects eve-studio.");
  console.error("Because @eve-studio/ui is bundled into the eve-studio CLI package, UI changes must release eve-studio.");
  process.exit(1);
}

console.log("Changeset coverage check passed.");
