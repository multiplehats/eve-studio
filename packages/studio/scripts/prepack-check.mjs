// npm pack/publish runs `prepack` from this package dir, but dist/ui is
// populated only by the repo-root `pnpm build:studio` (UI build -> studio
// build -> copy). This package's own `build` is plain tsc, so a bare
// `npm publish` would silently ship an API-only package with no browser UI.
import { existsSync } from "node:fs";

if (!existsSync(new URL("../dist/ui/_shell.html", import.meta.url))) {
  console.error("eve-studio prepack: dist/ui/_shell.html missing. Run `pnpm build:studio` at the repo root before packing/publishing.");
  process.exit(1);
}
