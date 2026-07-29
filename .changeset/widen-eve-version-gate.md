---
"eve-studio": minor
---

Support eve >=0.25.0 <0.28.0 projects (was 0.22.x). The bundled `eve/client` message reducer is now the 0.27 one, matching the event protocol of supported agents.

Fix `--scan-disk` to find historical sessions under eve 0.27's on-disk layout: the local Workflow World's data directory moved from `<project>/.workflow-data` to `<project>/.eve/.workflow-data`. The chunk/session format itself is unchanged.
