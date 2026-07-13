# Studio reliability design

**Date:** 2026-07-13
**Status:** Approved for implementation under the maintainer's full-autonomy launch brief

## Goal

Make the bundled Studio feel dependable during a live run and permanently protect cold direct-session URLs.

## Direct-session finding

The reported hang is not reproducible on the current tree or the published `eve-studio@0.1.0` server/assets. Fresh Chromium sessions loaded `/sessions/<fixture-id>` from both `127.0.0.1` and `localhost`; the document, dynamic route chunk, session API, and health request returned `200`, known fixture messages rendered, and there were no console errors. A missing ID rendered the intended error state.

The server already returns the SPA shell for extensionless paths. No speculative router rewrite is warranted. The missing protection is browser-level regression coverage: current tests prove only that HTML is returned, not that a cold dynamic URL hydrates and loads its chunk.

## Browser regression gate

Add a Playwright Chromium smoke that:

1. starts the deterministic fixture collector on an isolated port;
2. obtains a fixture session ID;
3. creates a fresh browser context and navigates directly to the encoded session URL;
4. asserts the session header and known mock messages render;
5. fails on page errors, error-level console messages, failed document/script/API responses, or a persistent loading state;
6. reloads the same URL and asserts it renders again.

CI and the pre-publish release job install only Chromium and run this gate. The cheaper Studio smoke also fetches the direct URL and verifies that it returns the branded HTML shell.

## Failed-detail recovery

SSE `session` updates merge the sidebar summary and also trigger the same per-session detail invalidation throttle used for event updates. This lets an open direct URL recover if its initial detail query briefly returned `404` before the first session snapshot became visible. React Query should not issue duplicate immediate refetches; the existing per-key coalescer remains the scheduling point.

## Live transcript behavior

The scroll container follows new content only while the viewer is already near the bottom. If the viewer scrolls upward, Studio preserves their position and displays a `Jump to latest` control. Activating it resumes follow mode. This applies to message deltas as well as new turns.

The turn drawer stores an open turn ID rather than a stale `Turn` object. Every render resolves that ID against freshly grouped turns, so streamed text, tool status, timing, and copy output update while the drawer is open.

## Navigation and grouping

- The no-session/root view includes an always-reachable sidebar trigger on mobile and when collapsed.
- Sidebar grouping identity uses project root digest plus project name, preventing two projects with the same package name from merging. Labels stay concise and disambiguate only when names collide.
- Session rows remain newest-first and expose status with text for assistive technology.

## Recovery display

Projection diagnostics are shown as a warning banner with a skipped-event count and the latest bounded reason. Raw events remain available. Gap, epoch-reset, retention, and Eve-version mismatch warnings remain distinct.

## Scope boundary

This patch does not add editing, replay, export, demo mode, or remote transport. It also does not replace the full-session detail API with a cursor protocol; event invalidation stays throttled and can be revisited after launch with real profiling data.

## Verification

Pure UI tests cover query invalidation, grouping, open-drawer freshness, and scroll-follow state. Component tests cover the root sidebar trigger and recovery banner. The built browser smoke is the release-level evidence for cold direct URLs.
