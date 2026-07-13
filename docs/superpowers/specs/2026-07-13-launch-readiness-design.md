# Launch readiness design

**Date:** 2026-07-13
**Status:** Approved for implementation under the maintainer's full-autonomy launch brief

## Goal

Make the repository, npm packages, landing page, and release path look intentional and verifiable before the X announcement, while preserving the frictionless `npx eve-studio` command.

## npm naming and ownership

Keep the public package names:

- `eve-studio` — the unscoped executable, so `npx eve-studio` stays memorable;
- `@eve-studio/extension` — the scoped Eve capture extension.

npm organizations can manage access to an unscoped package, so renaming the CLI to `@eve-studio/cli` creates migration cost without solving the ownership issue. After merge, a logged-in npm owner should grant the `eve-studio` organization developer team read/write access to the unscoped package and verify collaborators for both packages. Publishing itself remains CI-only through Trusted Publishing.

## Package identity

CLI description:

> Local observability workspace for eve agents. Inspect live sessions, messages, tool calls, steps, and usage in your browser.

Extension description:

> Capture extension for eve-studio. Streams local eve session events to the Studio collector for live, read-only inspection.

Both manifests add the verified author identity, focused discovery keywords, MIT metadata, repository directory, issues URL, and public/provenance publish settings. GitHub remains the homepage until a stable custom domain replaces the provisional Vercel URL.

Restore the exact 2026 MIT license at the repository root and in both published package directories. Add a real extension README that explains its relationship to the CLI, mounting, environment behavior, local-only delivery, and supported Eve range. Artifact inspection requires `README.md` and `LICENSE` in both tarballs and validates the trust metadata rather than merely checking compiled files.

## OSS documentation

- Root README leads with a screenshot, a compact value proposition, prerequisites, quick start, privacy model, package map, compatibility, development checks, and beta status.
- Studio and extension package READMEs are complete when viewed on npm.
- Contributing and UI docs use correct root-level commands and include `apps/web`.
- `SECURITY.md` names supported versions and directs private reports through GitHub private vulnerability reporting, with maintainer email fallback.
- Node `>=24` and pnpm `10.33.4` are explicit prerequisites.

## Deterministic quality gates

- `smoke:capture` always uses Eve's mock probe, sets `EVE_STUDIO_MOCK=1`, and removes paid-provider credentials from its child environment.
- CI runs lint, format check, all tests, typecheck, release build, marketing build, Studio smoke, browser deep-link smoke, workflow hardening, and artifact inspection.
- The release build-pack job runs the same behavioral Studio/browser smokes before packing.
- Workflow-policy tests pin these gates so a later edit cannot silently remove them.
- Generated route trees are excluded from formatting; authored UI code is brought to zero lint warnings and zero Prettier drift.

## Landing page and social preview

Add canonical, Open Graph, and X card metadata from one public-origin constant. Use `summary_large_image` and a checked-in 1200×630 image derived from the real Studio fixture UI, with dimensions and alt text.

Accessibility fixes:

- raise faint small text to at least 4.5:1 contrast;
- model package-manager selectors as pressed choices, not incomplete tabs;
- announce successful copy through an `aria-live` region;
- label the project-links navigation.

The marketing framework and visual direction remain unchanged. Bundle-size and static-rendering work are deferred until they have measured launch impact.

## Versioning

Add a patch changeset for both published packages. It describes live-stream correctness, delivery/mount safety, compatibility, and package trust changes. Version files are still produced by the existing Changesets release PR; package versions are not edited manually.

## External actions after merge

These require npm/GitHub account authority and are not performed by repository code:

```sh
npm access grant read-write eve-studio:developers eve-studio
npm access list collaborators eve-studio
npm access list collaborators @eve-studio/extension
```

Also verify npm Trusted Publishing points at the repository's `release.yml` workflow and add repository topics such as `eve`, `ai-agents`, `observability`, and `developer-tools` if they are still absent.

## Scope boundary

No package rename, custom-domain migration, GitHub template suite, Code of Conduct, landing-framework rewrite, or broad feature work is included. Those changes do not improve the reliability of the announcement build enough to justify their launch risk.
