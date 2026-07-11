// Ships the built SPA inside the eve-studio package: dist/ui is what the CLI serves.
import { cpSync, existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const src = fileURLToPath(new URL("../packages/ui/dist/client", import.meta.url));
const dest = fileURLToPath(new URL("../packages/studio/dist/ui", import.meta.url));

if (!existsSync(`${src}/_shell.html`)) {
  console.error("copy-ui: packages/ui/dist/client/_shell.html missing — run the UI build first");
  process.exit(1);
}
rmSync(dest, { recursive: true, force: true });
cpSync(src, dest, { recursive: true });
console.log("copy-ui: packages/ui/dist/client -> packages/studio/dist/ui");
