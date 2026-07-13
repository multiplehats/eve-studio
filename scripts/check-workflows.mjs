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
const mainRefCondition = "github.ref == 'refs/heads/main'";

const versionPatchCommand = `for changelog in packages/studio/CHANGELOG.md packages/extension/CHANGELOG.md; do
  if [ -e "$changelog" ]; then
    git add --intent-to-add "$changelog"
  fi
done
if git diff --quiet; then
  echo "has_changes=false" >> "$GITHUB_OUTPUT"
else
  echo "has_changes=true" >> "$GITHUB_OUTPUT"
  git diff --binary > changeset-version.patch
fi`;

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

const checksumCommands = new Map([
  ["cd release-artifacts && sha256sum -c SHA256SUMS", "256"],
  ["cd release-artifacts && sha512sum -c SHA512SUMS", "512"],
]);

function checksumPublishLoop(algorithm) {
  return `while IFS='  ' read -r checksum tarball; do
  case "$tarball" in
    ""|*/*|*\\\\*|*..*|*[!A-Za-z0-9._@+-]*)
      exit 1
      ;;
  esac
  case "$tarball" in
    *.tgz)
      npm publish "./release-artifacts/$tarball" --provenance --ignore-scripts
      ;;
    *)
      exit 1
      ;;
  esac
done < release-artifacts/SHA${algorithm}SUMS`;
}

const checksumPublishLoops = new Map([
  [checksumPublishLoop("256"), "256"],
  [checksumPublishLoop("512"), "512"],
]);

const releaseEligibilityCommand = `set -euo pipefail
rm -rf publish-artifacts
mkdir publish-artifacts
while IFS='  ' read -r checksum tarball; do
  case "$tarball" in
    ""|*/*|*\\\\*|*..*|*[!A-Za-z0-9._@+-]*)
      exit 1
      ;;
  esac
  case "$tarball" in
    *.tgz)
      spec="$(tar -xOf "release-artifacts/$tarball" package/package.json | node -e 'let source=""; process.stdin.setEncoding("utf8"); process.stdin.on("data", (chunk) => { source += chunk; }); process.stdin.on("end", () => { const manifest = JSON.parse(source); if (typeof manifest.name !== "string" || typeof manifest.version !== "string") process.exit(1); process.stdout.write(manifest.name + "@" + manifest.version); });')"
      if lookup="$(npm view "$spec" version --json 2>&1)"; then
        echo "$spec is already published; skipping"
      elif printf '%s\\n' "$lookup" | grep -Eq '"code"[[:space:]]*:[[:space:]]*"E404"'; then
        printf '%s  %s\\n' "$checksum" "$tarball" >> publish-artifacts/SHA256SUMS
        cp "release-artifacts/$tarball" "publish-artifacts/$tarball"
      else
        printf '%s\\n' "$lookup" >&2
        exit 1
      fi
      ;;
    *)
      exit 1
      ;;
  esac
done < release-artifacts/SHA256SUMS
if [ -s publish-artifacts/SHA256SUMS ]; then
  (cd publish-artifacts && sha256sum -c SHA256SUMS)
  echo "has_publishable_tarballs=true" >> "$GITHUB_OUTPUT"
else
  echo "has_publishable_tarballs=false" >> "$GITHUB_OUTPUT"
fi`;

function containsSelfHosted(value, seen = new WeakSet()) {
  if (typeof value === "string") return value.toLowerCase().includes("self-hosted");
  if (Array.isArray(value)) return value.some((item) => containsSelfHosted(item, seen));
  if (!isMapping(value) || seen.has(value)) return false;
  seen.add(value);
  return Object.values(value).some((item) => containsSelfHosted(item, seen));
}

const oidcPublishRunners = new Set(["ubuntu-24.04"]);
const oidcPublishActionInputs = new Map([
  ["actions/setup-node", new Map([["node-version", "24"], ["registry-url", "https://registry.npmjs.org"]])],
  ["actions/download-artifact", new Map([["name", "npm-release-artifacts"], ["path", "release-artifacts"]])],
]);

function isExpression(value) {
  return typeof value === "string" && value.includes("${{");
}

function checkOidcPublishActionInputs(file, actionPath, inputs) {
  const allowedInputs = oidcPublishActionInputs.get(actionPath);
  if (!allowedInputs) return;

  if (!isMapping(inputs)) {
    fail(file, `OIDC publish ${actionPath} with must be a mapping`);
    return;
  }

  for (const [key, value] of Object.entries(inputs)) {
    const expectedValue = allowedInputs.get(key);
    if (expectedValue === undefined) {
      fail(file, `OIDC publish ${actionPath} may not define with.${key}`);
    } else if (isExpression(value) || String(value) !== expectedValue) {
      fail(file, `OIDC publish ${actionPath} with.${key} must be ${expectedValue}`);
    }
  }

  const requiredInputs = actionPath === "actions/download-artifact"
    ? allowedInputs.keys()
    : ["node-version"];
  for (const key of requiredInputs) {
    if (!Object.hasOwn(inputs, key)) {
      fail(file, `OIDC publish ${actionPath} must define with.${key}`);
    }
  }
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

function checkReleasePublishEligibility(file, workflow) {
  const buildPackJob = workflow.jobs?.["build-pack"];
  if (!isMapping(buildPackJob)) {
    fail(file, "release workflow must define a build-pack job");
    return;
  }

  if (buildPackJob.outputs?.has_publishable_tarballs !== "${{ steps.eligibility.outputs.has_publishable_tarballs }}") {
    fail(file, "build-pack must expose the checksum-bound release eligibility output");
  }

  const eligibilityStep = Array.isArray(buildPackJob.steps)
    ? buildPackJob.steps.find((step) => isMapping(step) && step.id === "eligibility")
    : undefined;
  if (!isMapping(eligibilityStep) || typeof eligibilityStep.run !== "string" || eligibilityStep.run.trim() !== releaseEligibilityCommand) {
    fail(file, "build-pack must select unpublished tarballs from SHA256SUMS before publishing");
  }

  const artifactStep = Array.isArray(buildPackJob.steps)
    ? buildPackJob.steps.find((step) => isMapping(step) && step.uses?.startsWith("actions/upload-artifact@"))
    : undefined;
  if (
    artifactStep?.if !== "steps.eligibility.outputs.has_publishable_tarballs == 'true'" ||
    artifactStep?.with?.name !== "npm-release-artifacts" ||
    artifactStep.with?.path !== "publish-artifacts/"
  ) {
    fail(file, "build-pack must upload only the checksum-bound eligible release artifacts");
  }
}

function jobRunCommands(job) {
  if (!isMapping(job) || !Array.isArray(job.steps)) return [];
  return job.steps
    .filter((step) => isMapping(step) && typeof step.run === "string")
    .map((step) => step.run.trim());
}

function requireRunCommands(file, jobName, job, requiredCommands) {
  if (!isMapping(job)) {
    fail(file, `workflow must define a ${jobName} job`);
    return;
  }

  const commands = jobRunCommands(job);
  for (const command of requiredCommands) {
    if (!commands.includes(command)) {
      fail(file, `${jobName} must run \`${command}\``);
    }
  }
}

function requireCommandBefore(file, jobName, job, command, boundary) {
  const commands = jobRunCommands(job);
  const commandIndex = commands.indexOf(command);
  const boundaryIndex = commands.indexOf(boundary);
  if (commandIndex === -1 || boundaryIndex === -1 || commandIndex >= boundaryIndex) {
    fail(file, `${jobName} must run \`${command}\` before \`${boundary}\``);
  }
}

function checkCiLaunchGates(file, workflow) {
  const checksJob = workflow.jobs?.checks;
  const requiredCommands = [
    "pnpm lint",
    "pnpm format:check",
    "pnpm --filter @eve-studio/web build",
    "pnpm exec playwright install --with-deps chromium",
    "pnpm smoke:browser",
  ];
  requireRunCommands(file, "checks", checksJob, requiredCommands);
  requireCommandBefore(
    file,
    "checks",
    checksJob,
    "pnpm exec playwright install --with-deps chromium",
    "pnpm smoke:browser",
  );
}

function checkReleaseBehaviorGates(file, workflow) {
  const buildPackJob = workflow.jobs?.["build-pack"];
  const requiredCommands = [
    "pnpm smoke:studio",
    "pnpm exec playwright install --with-deps chromium",
    "pnpm smoke:browser",
  ];
  requireRunCommands(file, "build-pack", buildPackJob, requiredCommands);
  for (const command of requiredCommands) {
    requireCommandBefore(
      file,
      "build-pack",
      buildPackJob,
      command,
      "pnpm check:release-artifacts",
    );
  }
  requireCommandBefore(
    file,
    "build-pack",
    buildPackJob,
    "pnpm exec playwright install --with-deps chromium",
    "pnpm smoke:browser",
  );
}

function checkReleaseRefAndVersionPatch(file, workflow) {
  const expectedConditions = new Map([
    ["version-plan", mainRefCondition],
    ["version-pr", `${mainRefCondition} && needs.version-plan.outputs.has_changes == 'true'`],
    ["build-pack", `${mainRefCondition} && needs.version-plan.outputs.has_changes == 'false'`],
    ["publish", `${mainRefCondition} && needs.build-pack.outputs.has_publishable_tarballs == 'true'`],
  ]);
  for (const [jobName, expected] of expectedConditions) {
    if (workflow.jobs?.[jobName]?.if !== expected) {
      fail(file, `${jobName} must be restricted to refs/heads/main`);
    }
  }

  const versionPlan = workflow.jobs?.["version-plan"];
  const decideStep = Array.isArray(versionPlan?.steps)
    ? versionPlan.steps.find((step) => isMapping(step) && step.id === "decide")
    : undefined;
  if (!isMapping(decideStep) || typeof decideStep.run !== "string" || decideStep.run.trim() !== versionPatchCommand) {
    fail(file, "version-plan must include new package changelogs in the version patch");
  }
}

function checkOidcPublishJob(file, workflow) {
  const publishJob = workflow.jobs?.publish;
  if (!isMapping(publishJob)) {
    fail(file, "release workflow must define a publish job");
    return;
  }

  if (
    !isMapping(publishJob.permissions) ||
    Object.keys(publishJob.permissions).length !== 2 ||
    publishJob.permissions.contents !== "read" ||
    publishJob.permissions["id-token"] !== "write"
  ) {
    fail(file, "OIDC publish job permissions must be exactly contents: read and id-token: write");
  }

  if (publishJob.environment !== "npm-publish") {
    fail(file, "OIDC publish job environment must be npm-publish");
  }

  if (publishJob.needs !== "build-pack") {
    fail(file, "OIDC publish job must depend only on build-pack eligibility");
  }
  if (publishJob.if !== `${mainRefCondition} && needs.build-pack.outputs.has_publishable_tarballs == 'true'`) {
    fail(file, "OIDC publish job must run only when checksum-bound tarballs are eligible");
  }

  for (const field of ["env", "defaults"]) {
    if (Object.hasOwn(workflow, field)) {
      fail(file, `OIDC publish workflow may not define root-level ${field}`);
    }
  }

  for (const field of ["container", "services"]) {
    if (Object.hasOwn(publishJob, field)) {
      fail(file, `OIDC publish job may not define ${field}`);
    }
  }

  for (const field of ["runs-on"]) {
    if (containsSelfHosted(publishJob[field])) {
      fail(file, `OIDC publish job ${field} may not use self-hosted execution`);
    }
  }

  if (!oidcPublishRunners.has(publishJob["runs-on"])) {
    fail(file, "OIDC publish job runs-on must be ubuntu-24.04");
  }

  if (Object.hasOwn(publishJob, "env")) {
    fail(file, "OIDC publish job may not define environment variables");
  }

  if (Object.hasOwn(publishJob, "continue-on-error")) {
    fail(file, "OIDC publish job may not define continue-on-error");
  }

  if (Object.hasOwn(publishJob.defaults?.run ?? {}, "shell")) {
    fail(file, "OIDC publish job may not override defaults.run.shell");
  }

  if (!Array.isArray(publishJob.steps)) {
    fail(file, "OIDC publish job steps must be a sequence");
    return;
  }

  let downloadsReleaseTarballs = false;
  const verifiedAlgorithms = new Set();
  const publishedAlgorithms = new Set();

  for (const step of publishJob.steps) {
    if (!isMapping(step)) {
      fail(file, "OIDC publish job steps must be mappings");
      continue;
    }

    if (Object.hasOwn(step, "env")) {
      fail(file, "OIDC publish job steps may not define environment variables");
    }

    if (Object.hasOwn(step, "shell")) {
      fail(file, "OIDC publish job steps may not override the shell");
    }

    if (Object.hasOwn(step, "continue-on-error")) {
      fail(file, "OIDC publish job steps may not define continue-on-error");
    }

    if (typeof step.uses === "string") {
      const [actionPath] = step.uses.split("@");
      if (actionPath !== "actions/setup-node" && actionPath !== "actions/download-artifact") {
        fail(file, "OIDC publish job may only use setup-node and download-artifact actions");
      } else {
        checkOidcPublishActionInputs(file, actionPath, step.with);
        if (actionPath === "actions/download-artifact") downloadsReleaseTarballs = true;
      }
    }

    if (Object.hasOwn(step, "run")) {
      if (typeof step.run !== "string") {
        fail(file, "OIDC publish job run commands must be strings");
        continue;
      }

      const command = step.run.trim();
      const checksumAlgorithm = checksumCommands.get(command);
      const publishAlgorithm = checksumPublishLoops.get(command);
      if (checksumAlgorithm) {
        if (Object.hasOwn(step, "if")) {
          fail(file, "OIDC checksum verification steps may not define if conditions");
        }
        verifiedAlgorithms.add(checksumAlgorithm);
      } else if (publishAlgorithm) {
        if (Object.hasOwn(step, "if")) {
          fail(file, "OIDC publish steps may not define if conditions");
        }
        if (!verifiedAlgorithms.has(publishAlgorithm)) {
          fail(file, `OIDC publish loop must verify SHA${publishAlgorithm}SUMS before publishing`);
        }
        publishedAlgorithms.add(publishAlgorithm);
      } else {
        fail(file, "OIDC publish job may only verify checksums or run the checksum-bound publish loop");
      }
    }

    if (!Object.hasOwn(step, "uses") && !Object.hasOwn(step, "run")) {
      fail(file, "OIDC publish job steps must use an approved action or command");
    }
  }

  if (verifiedAlgorithms.size === 0) {
    fail(file, "OIDC publish job must verify release-artifacts checksums before publishing");
  }

  if (!downloadsReleaseTarballs) {
    fail(file, "OIDC publish job must download the eligible release tarballs");
  }

  if (publishedAlgorithms.size === 0) {
    fail(file, "OIDC publish job must run a checksum-bound publish loop");
  }

  for (const algorithm of publishedAlgorithms) {
    if (!verifiedAlgorithms.has(algorithm)) {
      fail(file, `OIDC publish loop must use the verified SHA${algorithm}SUMS manifest`);
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
  if (fileName === "ci.yml") {
    checkCiLaunchGates(file, workflow);
  } else if (fileName === "release.yml") {
    checkReleaseBehaviorGates(file, workflow);
    checkReleaseRefAndVersionPatch(file, workflow);
    checkReleasePublishEligibility(file, workflow);
    checkOidcPublishJob(file, workflow);
  }
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
