# Contributing

Thanks for your interest in contributing to eve-studio. Please take a moment to
review this guide before opening your first pull request.

Before starting work, check the existing issues and pull requests to see whether
someone is already working on something similar. If you need help or want to
discuss a change before opening a pull request, reach out to
[@itschrisjayden](https://x.com/itschrisjayden).

## About this repository

This repository is a pnpm workspace.

- Development requires Node.js 24 or newer and pnpm 10.33.4.
- We use [pnpm](https://pnpm.io) and workspaces for package management.
- The root package contains shared scripts for testing, typechecking, building,
  and smoke testing.
- The browser UI is private and ships as static assets inside the `eve-studio`
  package.

## Structure

```txt
packages/
|-- studio/      # eve-studio CLI, collector server, registry, and API
|-- extension/   # eve extension that forwards session events
`-- ui/          # private browser UI bundled into the studio package

apps/
|-- demo-agent/  # local eve agent fixture for smoke testing
`-- web/         # project landing page
```

| Path | Description |
| ---- | ----------- |
| `packages/studio` | The published `eve-studio` CLI and collector package. |
| `packages/extension` | The `@eve-studio/extension` package mounted into eve projects. |
| `packages/ui` | The private React/TanStack browser UI served by the collector. |
| `apps/demo-agent` | A local eve project used for development and smoke testing. |
| `apps/web` | The public project landing page. |

## Development

### Fork this repository

Fork the repository from GitHub, then clone your fork locally:

```sh
git clone https://github.com/your-username/eve-studio.git
```

### Install dependencies

```sh
cd eve-studio
pnpm install
```

### Create a branch

```sh
git checkout -b my-change
```

### Build Studio

Build the UI, collector, and CLI from the root:

```sh
pnpm build:studio
```

### Run the smoke check

```sh
pnpm smoke:studio
```

## Working on packages

Use pnpm filters when iterating on a single package:

```sh
pnpm --filter eve-studio test
pnpm --filter @eve-studio/extension test
pnpm --filter @eve-studio/ui dev
```

For UI development, start the fixture collector and Vite dev server separately:

```sh
pnpm --filter eve-studio build
pnpm --filter @eve-studio/ui dev:collector
pnpm --filter @eve-studio/ui dev
```

Then open `http://127.0.0.1:43120`.

## Pull requests

Please keep pull requests focused. A small pull request that changes one thing
is easier to review and safer to merge.

When opening a pull request:

1. Describe the user-facing behavior or developer workflow that changed.
2. Include tests for capture, reduction, routing, or UI behavior when practical.
3. Run the checks that match your change before requesting review.

Useful root checks:

```sh
pnpm lint
pnpm format:check
pnpm test
pnpm typecheck
pnpm smoke:studio
```

## Changesets and releases

This repository uses Changesets for npm versions and changelogs.

Every pull request that changes `eve-studio`, `@eve-studio/extension`, or the bundled UI in `packages/ui` must include a changeset:

```sh
pnpm changeset
```

Select `eve-studio` for CLI, collector, bundled UI, or `npx eve-studio` behavior changes. Select `@eve-studio/extension` for extension runtime changes. Because releases are fixed together, most runtime changes should select both packages unless the change is clearly package-local.

For docs-only, tests-only, CI-only, or refactor changes that should not publish a package, create an empty changeset:

```sh
pnpm changeset --empty
```

Do not manually edit package versions or changelog sections. The release workflow opens a generated version PR. Merging that PR publishes exact, checksum-verified npm tarballs from CI.

Publishing uses npm Trusted Publishing through GitHub OIDC. Do not add npm tokens to this repository.

## Commit convention

Use clear, conventional commit messages when possible:

```txt
feat(studio): add disk session scan status
fix(extension): preserve tool error metadata
docs(readme): clarify local UI development
test(ui): cover reconnect footer state
```

Common categories are `feat`, `fix`, `docs`, `test`, `refactor`, `build`, `ci`,
and `chore`.

## Security

Please do not open public issues for security vulnerabilities. Follow the
[security policy](SECURITY.md) to report them privately.
