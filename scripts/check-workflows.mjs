import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { parseDocument } from "yaml";

const workflowDir = ".github/workflows";
const allowList = new Map([
  ["actions/checkout", "de0fac2e4500dabe0009e67214ff5f5447ce83dd"],
  ["actions/setup-node", "2028fbc5c25fe9cf00d9f06a71cc4710d4507903"],
  ["pnpm/action-setup", "7088e561eb65bb68695d245aa206f005ef30921d"],
  ["actions/upload-artifact", "043fb46d1a93c77aae656e7c1c64a875d1fc6a0a"],
  ["actions/download-artifact", "3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c"],
]);

const failures = [];

function fail(file, message) {
  failures.push(`${file}: ${message}`);
}

function isMapping(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isSecretReference(value) {
  return typeof value === "string" && /\bsecrets\b/.test(value);
}

function isNpmTokenReference(value) {
  return typeof value === "string" &&
    /\b(?:NPM_TOKEN|NODE_AUTH_TOKEN|NPM_CONFIG_[A-Z0-9_]*TOKEN)\b/i.test(value);
}

function containsPullRequestTarget(value, seen = new WeakSet()) {
  if (value === "pull_request_target") return true;
  if (Array.isArray(value)) return value.some((item) => containsPullRequestTarget(item, seen));
  if (!isMapping(value)) return false;
  if (seen.has(value)) return false;
  seen.add(value);
  return Object.entries(value).some(
    ([key, item]) => key === "pull_request_target" || containsPullRequestTarget(item, seen),
  );
}

function isAllowedPublishCommand(command) {
  return [
    /^sha512sum --check(?: --strict)? [^;&|`$]+$/,
    /^shasum -a 512 -c [^;&|`$]+$/,
    /^npm publish release-artifacts\/[A-Za-z0-9._@+-]+\.tgz --provenance(?: --access public)?$/,
  ].some((pattern) => pattern.test(command));
}

function checkActionReference(file, actionReference) {
  if (typeof actionReference !== "string") {
    fail(file, "action reference must be a string pinned to an allowed SHA");
    return;
  }

  const [actionPath, ref, ...extra] = actionReference.split("@");
  if (!actionPath || !ref || extra.length > 0) {
    fail(file, `action reference must include a pinned SHA: ${actionReference}`);
    return;
  }

  if (actionPath === "actions/cache" || actionPath.startsWith("actions/cache/")) {
    fail(file, "`actions/cache` and its sub-actions are forbidden");
    return;
  }

  const expectedSha = allowList.get(actionPath);
  if (!expectedSha) {
    fail(file, `third-party action ${actionPath} is not in the allow-list`);
    return;
  }

  if (ref !== expectedSha) {
    fail(file, `${actionPath} must be pinned to ${expectedSha}, found ${ref}`);
  }
}

function hasOidcWrite(value, seen = new WeakSet()) {
  if (Array.isArray(value)) return value.some((item) => hasOidcWrite(item, seen));
  if (!isMapping(value)) return false;
  if (seen.has(value)) return false;
  seen.add(value);
  return Object.entries(value).some(
    ([key, item]) => key === "id-token" && item === "write" || hasOidcWrite(item, seen),
  );
}

function checkOidcPublishJob(file, workflow) {
  const publishJob = workflow.jobs?.publish;
  if (!isMapping(publishJob) || !hasOidcWrite(publishJob)) return;

  if (publishJob.steps === undefined) return;
  if (!Array.isArray(publishJob.steps)) {
    fail(file, "OIDC publish job steps must be a sequence");
    return;
  }

  for (const step of publishJob.steps) {
    if (!isMapping(step)) {
      fail(file, "OIDC publish job steps must be mappings");
      continue;
    }

    if (typeof step.uses === "string") {
      const [actionPath] = step.uses.split("@");
      if (actionPath !== "actions/setup-node" && actionPath !== "actions/download-artifact") {
        fail(file, "OIDC publish job may only use setup-node and download-artifact actions");
      }
    }

    if (Object.hasOwn(step, "run")) {
      if (typeof step.run !== "string") {
        fail(file, "OIDC publish job run commands must be strings");
        continue;
      }

      const commands = step.run.split(/\r?\n/).map((command) => command.trim()).filter(Boolean);
      if (commands.length === 0 || commands.some((command) => !isAllowedPublishCommand(command))) {
        fail(file, "OIDC publish job may only verify checksums or publish a tarball with provenance");
      }
    }

    if (!Object.hasOwn(step, "uses") && !Object.hasOwn(step, "run")) {
      fail(file, "OIDC publish job steps must use an approved action or command");
    }
  }
}

function checkFile(file) {
  const text = readFileSync(file, "utf8");
  const document = parseDocument(text, { prettyErrors: false });
  if (document.errors.length > 0) {
    for (const error of document.errors) fail(file, `invalid YAML: ${error.message}`);
    return;
  }

  let workflow;
  try {
    workflow = document.toJS({ maxAliasCount: 100 });
  } catch (error) {
    fail(file, `unable to read YAML: ${error.message}`);
    return;
  }

  if (!isMapping(workflow)) {
    fail(file, "workflow must be a mapping");
    return;
  }

  if (containsPullRequestTarget(workflow.on)) {
    fail(file, "`pull_request_target` is forbidden");
  }

  const fileName = basename(file);
  const seen = new WeakSet();
  function walk(value, context = {}) {
    if (isSecretReference(value)) {
      fail(file, "repository secrets are forbidden; use github.token and Trusted Publishing/OIDC");
    }
    if (isNpmTokenReference(value)) {
      fail(file, "npm token environment variables and references are forbidden; use Trusted Publishing/OIDC");
    }

    if (Array.isArray(value)) {
      for (const item of value) walk(item, context);
      return;
    }

    if (!isMapping(value) || seen.has(value)) return;
    seen.add(value);

    for (const [key, item] of Object.entries(value)) {
      if (isNpmTokenReference(key)) {
        fail(file, "npm token environment variables and references are forbidden; use Trusted Publishing/OIDC");
      }
      if (key === "cache") fail(file, "workflow dependency caching is forbidden");
      if (key === "uses") checkActionReference(file, item);
      if (key === "id-token" && item === "write" && (fileName !== "release.yml" || context.jobName !== "publish")) {
        fail(file, "`id-token: write` is only allowed in release.yml publish job");
      }

      if (context.root && key === "jobs" && isMapping(item)) {
        for (const [jobName, job] of Object.entries(item)) walk(job, { jobName });
      } else {
        walk(item, context);
      }
    }
  }

  walk(workflow, { root: true });
  if (fileName === "release.yml") checkOidcPublishJob(file, workflow);
}

if (existsSync(workflowDir)) {
  for (const entry of readdirSync(workflowDir)) {
    if (entry.endsWith(".yml") || entry.endsWith(".yaml")) checkFile(join(workflowDir, entry));
  }
}

if (failures.length > 0) {
  console.error("Workflow hardening check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Workflow hardening check passed.");
