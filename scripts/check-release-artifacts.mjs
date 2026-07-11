import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const artifactDir = resolve(process.env.RELEASE_ARTIFACT_DIR ?? "release-artifacts");
const packages = [
  {
    dir: "packages/studio",
    name: "eve-studio",
    requiredFiles: ["dist/cli.js", "dist/index.js", "dist/index.d.ts", "dist/ui/_shell.html"],
    executableFiles: ["dist/cli.js"],
    shebangFiles: ["dist/cli.js"],
  },
  {
    dir: "packages/extension",
    name: "@eve-studio/extension",
    requiredFiles: [
      "dist/index.mjs",
      "dist/index.d.ts",
      "dist/tools/index.mjs",
      "dist/tools/index.d.ts",
      "ext/extension.ts",
      "ext/hooks/studio-forward.ts",
      "ext/lib/envelope.ts",
      "ext/lib/forwarder.ts"
    ],
    executableFiles: [],
    shebangFiles: [],
  },
];

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, { stdio: "pipe", encoding: "utf8", ...opts });
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`);
  }
  return result.stdout.trim();
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

rmSync(artifactDir, { recursive: true, force: true });
mkdirSync(artifactDir, { recursive: true });

const sums = [];

for (const pkg of packages) {
  const packageJson = readFileSync(join(pkg.dir, "package.json"), "utf8");
  assert(!packageJson.includes("workspace:"), `${pkg.name} package.json contains forbidden workspace: reference`);

  for (const required of pkg.requiredFiles) {
    assert(existsSync(join(pkg.dir, required)), `${pkg.name} missing built file ${required}`);
  }

  for (const file of pkg.shebangFiles) {
    const text = readFileSync(join(pkg.dir, file), "utf8");
    assert(text.startsWith("#!/usr/bin/env node\n"), `${pkg.name} ${file} is missing Node shebang`);
  }

  for (const file of pkg.executableFiles) {
    const mode = statSync(join(pkg.dir, file)).mode;
    assert((mode & 0o111) !== 0, `${pkg.name} ${file} is not executable`);
  }

  const packJson = run("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", artifactDir], { cwd: pkg.dir });
  const [packResult] = JSON.parse(packJson);
  const tarball = join(artifactDir, packResult.filename);
  const packedFiles = new Set(packResult.files.map((file) => file.path));

  for (const required of pkg.requiredFiles) {
    assert(packedFiles.has(required), `${pkg.name} tarball missing ${required}`);
  }

  for (const file of pkg.executableFiles) {
    const packed = packResult.files.find((entry) => entry.path === file);
    assert(packed, `${pkg.name} tarball missing executable ${file}`);
    if (typeof packed.mode === "number") {
      assert((packed.mode & 0o111) !== 0, `${pkg.name} packed ${file} is not executable`);
    }
  }

  assert(!packedFiles.has("package.json.orig"), `${pkg.name} tarball includes package.json.orig`);
  sums.push(`${sha256(tarball)}  ${packResult.filename}`);
}

writeFileSync(join(artifactDir, "SHA256SUMS"), `${sums.join("\n")}\n`);
console.log(`Release artifact check passed. Wrote ${artifactDir}`);
