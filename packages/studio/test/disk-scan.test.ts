import { cpSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createRegistry } from "../src/registry.js";
import { applyDiskScan, scanWorkflowData } from "../src/disk-scan.js";

const FIXTURE_ROOT = fileURLToPath(new URL("./fixtures/workflow-data/", import.meta.url));

function projectWithFixture(): string {
  const root = mkdtempSync(join(tmpdir(), "eve-studio-scan-"));
  cpSync(FIXTURE_ROOT, join(root, ".workflow-data"), { recursive: true });
  return root;
}

/**
 * Encodes a synthetic chunk file matching the REAL on-disk framing recorded
 * by the Task 2 probe (DEVIATIONS §Plan B Task 2, Step 7): a short binary
 * header, the literal ASCII marker "devl", followed by a JSON array
 * `[["Uint8Array", <n>], "<base64>"]` whose base64 element decodes to the
 * wire event's JSON text. The reader locates "devl" and parses everything
 * after it, so the leading header bytes are cosmetic here but included for
 * fidelity with the real files.
 */
function encodeChunk(event: { type: string; data?: unknown; meta?: { at: string } }): Buffer {
  const json = JSON.stringify(event) + "\n";
  const b64 = Buffer.from(json, "utf8").toString("base64");
  const payload = JSON.stringify([["Uint8Array", 1], b64]);
  return Buffer.concat([Buffer.from([0, 0, 0, 1, 0x11]), Buffer.from("devl", "ascii"), Buffer.from(payload, "utf8")]);
}

describe("scanWorkflowData", () => {
  it("recovers the mock session's full wire sequence from chunks", () => {
    const { sessions, skipped } = scanWorkflowData(projectWithFixture());
    expect(skipped).toBe(0);
    expect(sessions).toHaveLength(1);
    const [s] = sessions;
    expect(s.events[0].event.type).toBe("session.started");
    expect(s.events.map((e) => e.position)).toEqual(s.events.map((_, i) => i));
    expect(s.events.some((e) => e.event.type === "message.received")).toBe(true);
    // Disk path must be as clean as the live path: no O(n^2) payload leak.
    expect(s.events.some((e) => (e.event.data as { messageSoFar?: unknown } | undefined)?.messageSoFar !== undefined)).toBe(false);
    // Agent recovered from session.started's runtime.agentName (probe-verified field path).
    expect(s.agent).toBe("demo-agent");
  });

  it("missing .workflow-data -> empty result, no throw", () => {
    expect(scanWorkflowData(mkdtempSync(join(tmpdir(), "eve-studio-empty-")))).toEqual({ sessions: [], skipped: 0 });
  });

  it("corrupted chunk (bad base64) -> stream skipped, scan survives", () => {
    const root = projectWithFixture();
    // Overwrite the first chunk file of the only stream with garbage.
    const chunksDir = join(root, ".workflow-data", "streams", "chunks");
    const streamDir = join(chunksDir, readdirSync(chunksDir)[0]);
    const firstChunk = join(streamDir, readdirSync(streamDir).sort()[0]);
    writeFileSync(firstChunk, "%%%not-base64%%%");
    const { sessions, skipped } = scanWorkflowData(root);
    expect(sessions).toHaveLength(0);
    expect(skipped).toBe(1);
  });

  it("filters sessions with no message.received (noise predicate)", () => {
    // A synthetic stream whose decoded events lack message.received must be
    // excluded. Encoding matches the REAL observed framing (devl-wrapped
    // base64, see encodeChunk above) so this exercises the real parse path.
    const root = mkdtempSync(join(tmpdir(), "eve-studio-noise-"));
    const streamDir = join(root, ".workflow-data", "streams", "chunks", "strm_00000000000000000000000000_user");
    mkdirSync(streamDir, { recursive: true });
    const noiseEvents = [
      { type: "session.started", data: { runtime: { agentId: "noise-agent" } } },
      { type: "session.waiting", data: {} },
    ];
    noiseEvents.forEach((e, i) => {
      writeFileSync(join(streamDir, `chnk_${String(i).padStart(4, "0")}.bin`), encodeChunk(e));
    });
    const { sessions, skipped } = scanWorkflowData(root);
    expect(sessions).toHaveLength(0); // decodable but filtered: noise, not an error
    expect(skipped).toBe(0); // filtering is not a failure
  });
});

describe("applyDiskScan", () => {
  it("populates the registry; re-running is a no-op (idempotent on sessionId + position)", () => {
    const root = projectWithFixture();
    const r = createRegistry();
    const first = applyDiskScan(r, root);
    expect(first.sessions).toHaveLength(1);
    const before = r.stats().eventsAccepted;
    applyDiskScan(r, root);
    expect(r.stats().eventsAccepted).toBe(before);
    expect(r.stats().duplicatesDropped).toBeGreaterThan(0);
  });
});
