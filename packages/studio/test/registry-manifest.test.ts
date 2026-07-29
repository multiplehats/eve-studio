import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GENERATED_MOUNT, MOUNT_TARGET_RELATIVE_PATH, PKG } from "../src/mount.js";

const manifestPath = fileURLToPath(
  new URL("../../../apps/web/public/r/studio.json", import.meta.url),
);
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

describe("registry manifest", () => {
  it("has the expected top-level shape", () => {
    expect(manifest.$schema).toBe("https://ui.shadcn.com/schema/registry-item.json");
    expect(manifest.name).toBe("studio");
    expect(manifest.type).toBe("registry:item");
  });

  it("declares the extension package as a dependency", () => {
    expect(manifest.dependencies).toContain(PKG);
  });

  it("writes the byte-identical mount file at the same target the CLI mount flow uses", () => {
    const [file] = manifest.files;
    expect(file.type).toBe("registry:file");
    expect(file.target).toBe(MOUNT_TARGET_RELATIVE_PATH);
    expect(file.content).toBe(GENERATED_MOUNT);
  });
});
