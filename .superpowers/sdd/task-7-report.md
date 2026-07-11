# Task 7 Report: Split-Privilege Release Workflow

## Status

DONE

## Commit

- `958085c ci: add split-privilege trusted release workflow`

## Implementation

Created `.github/workflows/release.yml` with four jobs:

1. `version-plan` checks workflow hardening, applies Changesets versioning, and uploads a
   binary version patch only when version changes exist.
2. `version-pr` has the separately scoped `contents: write` and `pull-requests: write`
   permissions needed to apply that artifact and create or update `changeset-release/main`.
3. `build-pack` runs the required test, typecheck, release build, and tarball inspection
   before uploading `npm-release-artifacts`.
4. `publish` is an isolated OIDC Trusted Publishing job, constrained to `ubuntu-24.04`,
   downloading the artifact, verifying `SHA256SUMS`, then publishing only entries read from
   that verified manifest.

The workflow uses the repository's approved SHA-pinned actions. The publish job contains no
checkout, pnpm setup, environment variables, defaults, shell overrides, containers, or
services.

## Guard-policy adaptation

The task brief's publish script inspected every tarball with Node, checked whether a version
already existed on npm, and then conditionally published with `npm publish`. The current
`scripts/check-workflows.mjs` accepts only checksum verification and its exact
checksum-manifest-bound publish loop in an OIDC publish job. I therefore replaced that script
with the guard-approved SHA256 loop and added `--ignore-scripts` as required by the guard.

This preserves the required security boundary: publish inputs are limited to validated `.tgz`
filenames from `release-artifacts/SHA256SUMS`, after the full manifest has passed
`sha256sum -c`.

## Validation

- `pnpm check:workflows` passed: `Workflow hardening check passed.`
- `git diff --check` passed before the commit.
- Final workflow commit inspected: only `.github/workflows/release.yml` was committed.

## Concerns

The guard-approved publish loop intentionally has no preflight `npm view` skip for an already
published version, because the OIDC publish-job policy forbids commands other than checksum
verification and the exact publish loop. A duplicate publish would therefore fail rather than
be skipped, which is stricter than the original task brief but required by the current guard.

## Fix: Retry Eligible Releases

### What changed

- `build-pack` now selects only unpublished package tarballs before the `npm-publish`
  environment can be reached. It reads the existing `release-artifacts/SHA256SUMS` manifest,
  validates each filename, derives the package spec from that checksum-listed tarball, and uses
  `npm view` to skip versions already present in the registry.
- The selected tarballs and a filtered `SHA256SUMS` manifest are copied into
  `publish-artifacts/` and re-verified before upload. `build-pack` exposes
  `has_publishable_tarballs`; the OIDC `publish` job runs only when that output is `true`.
- The OIDC job remains unchanged: it only downloads `npm-release-artifacts`, verifies
  `SHA256SUMS`, and runs the exact manifest-bound `npm publish --provenance --ignore-scripts`
  loop.
- `scripts/check-workflows.mjs` now requires this checksum-bound eligibility gate, filtered
  artifact upload, and publish condition. This makes the prior unconditional retry shape fail
  the workflow guard.

### Validation

- RED: `pnpm check:workflows` exited 1 after the guard was added and before the workflow was
  changed. It reported the missing eligibility output, selection step, publish condition, and
  filtered artifact upload.
- GREEN: `pnpm check:workflows` exited 0 with `Workflow hardening check passed.`
- `pnpm typecheck` exited 0.
- `pnpm test` initially exited 1 in the filesystem sandbox because 11 server tests could not
  bind `127.0.0.1` (`listen EPERM`). The same command rerun with local loopback permission
  exited 0: 43 studio, 13 extension, and 30 UI tests passed.
- `git diff --check` exited 0.

### Remaining concern

The registry lookup and publish remain separate operations. If another actor publishes the same
version after the eligibility check, the strict OIDC loop can still fail on that tarball; a later
retry will filter it out and continue with any remaining unpublished tarballs.

## Fix: Review Blockers

### What changed

- Added `if: steps.eligibility.outputs.has_publishable_tarballs == 'true'` to the
  `Upload release tarballs` step. A complete repeat release now skips both upload and the
  already-gated publish job.
- Tightened `scripts/check-workflows.mjs` so `release.yml` must define `build-pack` and
  `publish`; the publish job must have exactly `contents: read` and `id-token: write`, use the
  `npm-publish` environment, depend on the checksum-bound eligibility output, download the
  eligible artifact, verify checksums, and run the checksum-bound publish loop. The guard retains
  the existing action, token, cache, secret, execution, and arbitrary-command restrictions.

### RED/GREEN Evidence

- RED (pre-fix): temporarily removed `id-token: write` from `publish` and ran
  `pnpm check:workflows`. It exited 0 with `Workflow hardening check passed.`, demonstrating the
  prior early-return bypass.
- RED (post-fix regression): temporarily removed the upload eligibility condition and ran
  `pnpm check:workflows`. It exited 1 with
  `build-pack must upload only the checksum-bound eligible release artifacts`.
- GREEN: `pnpm check:workflows` exited 0 with `Workflow hardening check passed.` after each
  temporary mutation was restored.

### Final Validation

- `pnpm check:workflows` exited 0.
- `node --check scripts/check-workflows.mjs` exited 0.
- `pnpm typecheck` exited 0 across all five workspace projects.
- `git diff --check` exited 0.

### Concerns

None. The workflow gate cannot execute a hosted release, but the local guard validates the
required static release shape and its negative cases.
