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

function checkFile(file) {
  const text = readFileSync(file, "utf8");
  const lines = text.split(/\r?\n/);
  const fileName = basename(file);

  lines.forEach((line, index) => {
    const lineNumber = index + 1;

    if (/\bpull_request_target\b/.test(line)) {
      fail(file, lineNumber, "`pull_request_target` is forbidden");
    }

    if (/\b(NPM_TOKEN|NODE_AUTH_TOKEN|secrets\.[A-Za-z0-9_]*NPM[A-Za-z0-9_]*)\b/.test(line)) {
      fail(file, lineNumber, "npm tokens/secrets are forbidden; use Trusted Publishing/OIDC");
    }

    if (/id-token:\s*write/.test(line)) {
      const job = currentJobForLine(lines, index);
      if (fileName !== "release.yml" || job !== "publish") {
        fail(file, lineNumber, "`id-token: write` is only allowed in release.yml publish job");
      }
    }

    const uses = line.match(/uses:\s*([^#\s]+)/);
    if (!uses) return;

    const [actionPath, ref] = uses[1].split("@");
    if (!actionPath || !ref) {
      fail(file, lineNumber, `action reference must include a pinned SHA: ${uses[1]}`);
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
