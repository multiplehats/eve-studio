# Launch readiness implementation plan

> Land artifact/workflow gates after runtime and UI work so they validate the final product, not an intermediate tree.

**Goal:** Present trustworthy npm packages and an announcement-ready open-source repository with deterministic release evidence.

**Architecture:** Package-local README/LICENSE files make npm pages self-contained. Repository scripts validate metadata and exact tarballs. CI and release share behavioral gates. The landing page gets standards-based metadata and a real-product social image without a redesign.

**Stack:** npm manifests/Changesets, GitHub Actions, TanStack Start marketing app, ESLint/Prettier.

---

## Task 1: Restore licenses and validate package identity

**Files:**

- Create `LICENSE`
- Create `packages/studio/LICENSE`
- Create `packages/extension/LICENSE`
- Modify `packages/studio/package.json`
- Modify `packages/extension/package.json`
- Modify `packages/studio/src/cli-program.ts`
- Modify `scripts/check-release-artifacts.mjs`

1. Add failing artifact assertions requiring `README.md`, `LICENSE`, nonempty approved description, author name/URL, at least four focused keywords, MIT license, repository directory, bugs URL, public access, and provenance.
2. Restore the exact MIT text with `Copyright (c) 2026 Chris Jayden` in all three locations.
3. Apply the approved descriptions and author/keyword metadata. Align CLI help with the CLI package description's first sentence.
4. Run `pnpm build:release && RELEASE_ARTIFACT_DIR=/tmp/eve-studio-release-audit pnpm check:release-artifacts` and inspect both file lists.
5. Commit `chore(packages): strengthen npm identity`.

## Task 2: Make npm and repository docs self-contained

**Files:**

- Create `packages/extension/README.md`
- Create `SECURITY.md`
- Modify `README.md`
- Modify `packages/studio/README.md`
- Modify `packages/ui/README.md`
- Modify `apps/web/README.md`
- Modify `CONTRIBUTING.md`

1. Write the extension README with install/mount examples, loopback/default port, inert production behavior, supported Eve range, failure isolation, and absolute support/security links.
2. Add a security policy supporting the latest release with GitHub private vulnerability reporting and `hi@chrisjayden.com` fallback.
3. Refine the root README: product screenshot, concise intro, Node/pnpm prerequisites, quick start, what is captured, local privacy boundary, compatibility, package/app map including `apps/web`, development checks, and beta note.
4. Correct UI commands to root filters and update Contributing/app docs.
5. Use the humanizer pass on prose: remove internal plan language, inflated claims, repeated conclusions, and vague filler.
6. Verify all relative links with `rg`/manual path checks and commit `docs: prepare repository for launch`.

## Task 3: Fix landing accessibility and social metadata

**Files:**

- Modify `apps/web/src/components/install-command.tsx`
- Modify `apps/web/src/routes/index.tsx`
- Modify `apps/web/src/routes/__root.tsx`
- Modify `apps/web/src/styles.css`
- Create `apps/web/public/og-image.png`

1. Add component-level checks where practical, otherwise verify through the browser smoke/manual accessibility snapshot.
2. Change package-manager controls to `role="group"` plus `aria-pressed`; add a polite live region for copy success; label project navigation.
3. Raise faint color to `#818181` and verify contrast on both `#000000` and `#161616`.
4. Define one public origin constant and add canonical, `og:url`, image URL/dimensions/alt, and complete `summary_large_image` X metadata.
5. Capture the stabilized real fixture Studio at a controlled viewport, compose/crop it into exactly `1200x630`, and inspect the checked-in PNG. Do not use a generic generated mock.
6. Run web build/typecheck and inspect metadata from the built output. Commit `feat(web): add launch social preview`.

## Task 4: Establish clean lint and formatting gates

**Files:**

- Modify `packages/ui/.prettierignore`
- Modify `packages/ui/package.json`
- Modify root `package.json`
- Mechanically format authored files under `packages/ui`
- Fix the existing ESLint findings without disabling whole rule families

1. Add generated route trees to `.prettierignore`.
2. Make UI lint `eslint --max-warnings 0 .` and check use `prettier --check` over authored source/config files.
3. Add root `lint` and `format:check` scripts.
4. Run the checks to capture the failing baseline, then apply mechanical formatting.
5. Fix semantic lint findings in focused files; use narrow generated/vendor overrides only where ownership requires them.
6. Run zero-warning lint/check plus tests/typecheck and commit `chore: enforce source quality gates`.

## Task 5: Make smoke tests deterministic

**Files:**

- Modify `scripts/smoke-capture.mjs`
- Modify `package.json` if naming an opt-in live probe

1. Change the automated eval to `mock-probe`.
2. Build its child environment from `process.env`, set `EVE_STUDIO_MOCK=1`, and delete `OPENROUTER_API_KEY`, `DEMO_MODEL`, and other supported paid-provider keys present in the demo configuration.
3. Preserve any paid/manual probe only under an explicitly named opt-in command that is never used by CI.
4. Run `pnpm smoke:capture` with a sentinel paid credential in the parent environment and prove the mock path succeeds without accessing it.
5. Commit `test: make capture smoke deterministic`.

## Task 6: Pin final CI and release behavior

**Files:**

- Modify `.github/workflows/ci.yml`
- Modify `.github/workflows/release.yml`
- Modify `scripts/check-workflows.mjs`

1. Add failing workflow-policy assertions for UI lint, format check, marketing build, Studio smoke, browser install/smoke in CI, and Studio/browser smoke in release build-pack.
2. Add explicit workflow steps. Install only Chromium with dependencies before the browser gate.
3. Keep least-privilege permissions, pinned actions, timeouts, and publish isolation intact.
4. Run `pnpm check:workflows` and a YAML parse check. Commit `ci: gate launch artifacts behaviorally`.

## Task 7: Add changeset and final artifact audit

**Files:**

- Create `.changeset/<descriptive-name>.md`

1. Add a patch changeset for `eve-studio` and `@eve-studio/extension` describing user-visible runtime and trust changes.
2. Run:

```sh
pnpm lint
pnpm format:check
pnpm test
pnpm typecheck
pnpm build:release
pnpm --filter @eve-studio/web build
pnpm smoke:capture
pnpm smoke:studio
pnpm smoke:browser
pnpm check:workflows
RELEASE_ARTIFACT_DIR=/tmp/eve-studio-release-audit pnpm check:release-artifacts
pnpm changeset:status
git diff --check
```

3. Extract both tarballs in `/tmp`; inspect README/LICENSE/manifest and ensure no workspace references, secrets, test fixtures, or source-map surprises.
4. Commit `chore: add launch stabilization changeset`.

## Task 8: External handoff (do not automate)

Provide the maintainer these post-merge commands; do not run them without active npm authentication and explicit external-state confirmation:

```sh
npm access grant read-write eve-studio:developers eve-studio
npm access list collaborators eve-studio
npm access list collaborators @eve-studio/extension
```

Also hand off Trusted Publishing and GitHub-topic checks. Do not publish, push, merge, or change repository settings as part of the local implementation.
