import { describe, expect, it } from "vitest";
import { createStudioProgram, invalidStudioPortMessage, parseStudioPort } from "../src/cli-program.js";

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

describe("parseStudioPort", () => {
  it("uses the default for an omitted port and accepts both range boundaries", () => {
    expect(parseStudioPort(undefined)).toBe(43110);
    expect(parseStudioPort("1")).toBe(1);
    expect(parseStudioPort("01")).toBe(1);
    expect(parseStudioPort("65535")).toBe(65535);
  });

  it.each(["0", "-1", "1.5", " 43110 ", "65536", "43110@evil", "+1", "NaN", "Infinity"])(
    "rejects invalid port %j",
    (value) => expect(parseStudioPort(value)).toBeUndefined(),
  );

  it("names the complete supported range in the CLI error", () => {
    expect(invalidStudioPortMessage("0")).toBe(
      "invalid --port 0; expected a decimal integer from 1 to 65535",
    );
  });
});
