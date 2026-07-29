# eve-studio

## 0.2.0

### Minor Changes

- e9a71f2: Support eve >=0.25.0 <0.28.0 projects (was 0.22.x). The bundled `eve/client` message reducer is now the 0.27 one, matching the event protocol of supported agents.

  Fix `--scan-disk` to find historical sessions under eve 0.27's on-disk layout: the local Workflow World's data directory moved from `<project>/.workflow-data` to `<project>/.eve/.workflow-data`. The chunk/session format itself is unchanged.

### Patch Changes

- e9a71f2: Publish an eve registry manifest so the Studio extension can be installed with `eve add`, with a test guarding manifest/mount drift.

## 0.1.2

### Patch Changes

- 1bcc2d6: Fix live assistant text, serialize collector delivery, recover session projections
  after missing or malformed events, and keep automatic extension mounting from
  overwriting existing project files.

  Tighten the supported eve range and local transport boundary, add direct-session
  browser coverage, and ship complete npm metadata, licenses, and package docs.
