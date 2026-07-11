import { describe, expect, it } from "vitest";
import { createStudioProgram } from "../src/cli-program.js";

describe("createStudioProgram", () => {
  it("documents the supported flags in help output", () => {
    const help = createStudioProgram().helpInformation();

    expect(help).toContain("Usage: eve-studio [options]");
    expect(help).toContain("--port <port>");
    expect(help).toContain("--project <path>");
    expect(help).toContain("--scan-disk");
    expect(help).toContain("-y, --yes");
  });
});
