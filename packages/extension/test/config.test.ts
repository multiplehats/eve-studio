import { describe, expect, it } from "vitest";
import { projectRootDigest, parseStudioPort } from "../ext/lib/config.js";

describe("parseStudioPort", () => {
  it("uses the collector default when the setting is missing", () => {
    expect(parseStudioPort(undefined)).toBe(43110);
  });

  it.each([
    ["1", 1],
    ["65535", 65535],
  ])("accepts the decimal port %s", (input, expected) => {
    expect(parseStudioPort(input)).toBe(expected);
  });

  it.each(["", "0", "-1", "1.5", " 43110 ", "65536", "43110@attacker.example", "0x10"])(
    "rejects the invalid port %j",
    (input) => {
      expect(parseStudioPort(input)).toBeUndefined();
    },
  );
});

describe("projectRootDigest", () => {
  it("returns a stable, path-opaque SHA-256 prefix", () => {
    const root = "/Users/chris/private-agent";
    const digest = projectRootDigest(root);

    expect(digest).toBe(projectRootDigest(root));
    expect(digest).toMatch(/^[a-f0-9]{12}$/);
    expect(digest).not.toContain("Users");
    expect(digest).not.toContain("chris");
    expect(projectRootDigest("/Users/chris/another-agent")).not.toBe(digest);
  });
});
