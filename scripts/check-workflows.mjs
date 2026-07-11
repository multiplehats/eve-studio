import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

const workflowDir = ".github/workflows";
const allowList = new Map([
  ["actions/checkout", "de0fac2e4500dabe0009e67214ff5f5447ce83dd"],
  ["actions/setup-node", "2028fbc5c25fe9cf00d9f06a71cc4710d4507903"],
  ["pnpm/action-setup", "7088e561eb65bb68695d245aa206f005ef30921d"],
  ["actions/upload-artifact", "043fb46d1a93c77aae656e7c1c64a875d1fc6a0a"],
  ["actions/download-artifact", "3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c"],
]);

const failures = [];

function fail(file, line, message) {
  failures.push(`${file}:${line}: ${message}`);
}

function yamlKeyPattern(key) {
  return `(?:${key}|"${key}"|'${key}')`;
}

function matchYamlKey(line, key) {
  return line.match(new RegExp(`^(\\s*)(?:-\\s*)?${yamlKeyPattern(key)}\\s*:\\s*(.*)`));
}

function hasYamlKey(line, key) {
  return new RegExp(`^\\s*(?:-\\s*)?${yamlKeyPattern(key)}\\s*:`).test(line);
}

function currentJobForLine(lines, index) {
  let inJobs = false;
  let job = "";
  for (let i = 0; i <= index; i += 1) {
    if (/^jobs:\s*$/.test(lines[i])) inJobs = true;
    if (!inJobs) continue;
    const match = lines[i].match(/^  ([A-Za-z0-9_-]+):\s*$/);
    if (match) job = match[1];
  }
  return job;
}

function hasOidcPublishJob(fileName, lines) {
  return lines.some(
    (line, index) =>
      matchYamlKey(line, "id-token")?.[2].trim() === "write" &&
      fileName === "release.yml" &&
      currentJobForLine(lines, index) === "publish",
  );
}

function isAllowedPublishCommand(command) {
  return [
    /^sha512sum --check(?: --strict)? [^;&|`$]+$/,
    /^shasum -a 512 -c [^;&|`$]+$/,
    /^npm publish (?:[^\s/]+\/)*[^\s/]+\.tgz --provenance(?: --access public)?$/,
  ].some((pattern) => pattern.test(command));
}

function checkOidcPublishJob(file, lines) {
  const fileName = basename(file);
  if (!hasOidcPublishJob(fileName, lines)) return;

  let runIndent = null;
  const forbiddenPublishContent = /\b(?:checkout|pnpm\/action-setup|pnpm|npm install|npm ci|npm run|npm test|npm exec|yarn|bun|build|typecheck|smoke)\b/i;

  lines.forEach((line, index) => {
    if (currentJobForLine(lines, index) !== "publish") return;

    const lineNumber = index + 1;
    if (forbiddenPublishContent.test(line)) {
      fail(file, lineNumber, "OIDC publish job must not install dependencies or run workspace code");
    }

    const uses = matchYamlKey(line, "uses");
    if (uses) {
      const [actionPath] = uses[2].split(/\s+#/, 1)[0].trim().split("@");
      if (actionPath !== "actions/setup-node" && actionPath !== "actions/download-artifact") {
        fail(file, lineNumber, "OIDC publish job may only use setup-node and download-artifact actions");
      }
    }

    const run = matchYamlKey(line, "run");
    if (run) {
      runIndent = run[1].length;
      const command = run[2].trim();
      if (command && command !== "|" && command !== ">") {
        if (!isAllowedPublishCommand(command)) {
          fail(file, lineNumber, "OIDC publish job may only verify checksums or publish a tarball with provenance");
        }
        runIndent = null;
      }
      return;
    }

    if (runIndent !== null) {
      const indent = line.match(/^\s*/)[0].length;
      if (!line.trim()) return;
      if (indent <= runIndent) {
        runIndent = null;
        return;
      }

      if (!isAllowedPublishCommand(line.trim())) {
        fail(file, lineNumber, "OIDC publish job may only verify checksums or publish a tarball with provenance");
      }
    }
  });
}

function checkFile(file) {
  const text = readFileSync(file, "utf8");
  const lines = text.split(/\r?\n/);
  const fileName = basename(file);

  checkOidcPublishJob(file, lines);

  lines.forEach((line, index) => {
    const lineNumber = index + 1;

    if (hasYamlKey(line, "pull_request_target")) {
      fail(file, lineNumber, "`pull_request_target` is forbidden");
    }

    if (/\bsecrets\./.test(line)) {
      fail(file, lineNumber, "repository secrets are forbidden; use github.token and Trusted Publishing/OIDC");
    }

    if (hasYamlKey(line, "cache")) {
      fail(file, lineNumber, "workflow dependency caching is forbidden");
    }

    if (matchYamlKey(line, "id-token")?.[2].trim() === "write") {
      const job = currentJobForLine(lines, index);
      if (fileName !== "release.yml" || job !== "publish") {
        fail(file, lineNumber, "`id-token: write` is only allowed in release.yml publish job");
      }
    }

    const uses = matchYamlKey(line, "uses");
    if (!uses) return;

    const actionReference = uses[2].split(/\s+#/, 1)[0].trim();
    const [actionPath, ref] = actionReference.split("@");
    if (!actionPath || !ref) {
      fail(file, lineNumber, `action reference must include a pinned SHA: ${actionReference}`);
      return;
    }

    if (actionPath === "actions/cache" || actionPath.startsWith("actions/cache/")) {
      fail(file, lineNumber, "`actions/cache` and its sub-actions are forbidden");
      return;
    }

    const expectedSha = allowList.get(actionPath);
    if (!expectedSha) {
      fail(file, lineNumber, `third-party action ${actionPath} is not in the allow-list`);
      return;
    }

    if (ref !== expectedSha) {
      fail(file, lineNumber, `${actionPath} must be pinned to ${expectedSha}, found ${ref}`);
    }
  });
}

if (existsSync(workflowDir)) {
  for (const entry of readdirSync(workflowDir)) {
    if (entry.endsWith(".yml") || entry.endsWith(".yaml")) {
      checkFile(join(workflowDir, entry));
    }
  }
}

if (failures.length > 0) {
  console.error("Workflow hardening check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Workflow hardening check passed.");
