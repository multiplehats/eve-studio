import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Registry } from "./types.js";

export interface DiskSession {
  sessionId: string;
  agent?: string;
  events: Array<{ position: number; event: { type: string; data?: unknown } }>;
}
export interface ScanResult { sessions: DiskSession[]; skipped: number } // skipped = unreadable/unparsable stream dirs

/** Design predicate: sessions with no message.received are eve-internal noise. */
function sessionHasUserActivity(events: DiskSession["events"]): boolean {
  return events.some((e) => e.event.type === "message.received");
}

/**
 * Same strip the extension applies on the live path (deliberately duplicated —
 * separate published packages, no shared internal lib): drop messageSoFar from
 * message.appended, recursing into subagent.event wrappers, copy-on-write,
 * never mutating input. Mirrors packages/extension/ext/lib/envelope.ts.
 */
function stripMessageSoFar(event: { type: string; data?: unknown }): { type: string; data?: unknown } {
  if (event.type === "message.appended" && event.data && typeof event.data === "object") {
    const { messageSoFar: _dropped, ...rest } = event.data as Record<string, unknown>;
    return { ...event, data: rest };
  }
  if (event.type === "subagent.event" && event.data && typeof event.data === "object" && "event" in (event.data as Record<string, unknown>)) {
    const nested = (event.data as Record<string, unknown>).event;
    if (nested && typeof nested === "object" && "type" in nested) {
      const stripped = stripMessageSoFar(nested as { type: string; data?: unknown });
      if (stripped !== nested) return { ...event, data: { ...(event.data as Record<string, unknown>), event: stripped } };
    }
  }
  return event;
}

/**
 * Recovers the sessionId from the chunk-directory name, not from decoded
 * event payloads or the run manifest — per DEVIATIONS §Plan B Task 2 Step 7:
 * neither the `streams/runs/<sessionId>.json` manifest contents nor the
 * decoded `session.started` chunk carry the sessionId; the durable-store
 * layer's naming convention is the only source of truth. The stream dir is
 * named `strm_<ULID>_user` where `<ULID>` is shared verbatim with the run id
 * `wrun_<ULID>`, so recovery is: strip the `strm_` prefix and `_user`
 * suffix, then prepend `wrun_`.
 */
function recoverSessionId(streamDirName: string): string | undefined {
  const match = /^strm_(.+)_user$/.exec(streamDirName);
  if (!match) return undefined;
  return `wrun_${match[1]}`;
}

/**
 * Best-effort agent name for the discovery UX: `ingestDisk` defaults to
 * "unknown" absent a supplied agent (registry.ts), so pull it from the
 * decoded `session.started` chunk's `data.runtime.agentName` when present
 * (per the probe's verbatim decoded chunk, DEVIATIONS §Plan B Task 2 Step 7).
 * Undefined (not "unknown") when absent so ingestDisk's own default applies.
 */
function recoverAgent(events: DiskSession["events"]): string | undefined {
  const started = events.find((e) => e.event.type === "session.started");
  const data = started?.event.data as { runtime?: { agentName?: unknown } } | undefined;
  const name = data?.runtime?.agentName;
  return typeof name === "string" ? name : undefined;
}

/**
 * Decodes one chunk file's wire event. Per DEVIATIONS §Plan B Task 2 Step 7,
 * each `.bin` file is a short binary header, the ASCII marker "devl", then a
 * JSON array `[["Uint8Array", n], "<base64>"]` — the base64 element decodes
 * to newline-terminated JSON text: `{"data":..., "type":..., "meta":{"at":...}}`.
 * We locate "devl" and JSON.parse everything after it rather than depending
 * on exact header byte lengths (observed to vary chunk to chunk).
 */
function decodeChunk(buf: Buffer): { type: string; data?: unknown } {
  const text = buf.toString("utf8");
  const markerIndex = text.indexOf("devl");
  if (markerIndex === -1) throw new Error("chunk missing devl marker");
  const arr = JSON.parse(text.slice(markerIndex + 4)) as unknown;
  if (!Array.isArray(arr) || typeof arr[1] !== "string") throw new Error("unexpected chunk array shape");
  const decoded = Buffer.from(arr[1], "base64").toString("utf8");
  const event = JSON.parse(decoded) as { type: string; data?: unknown };
  if (typeof event.type !== "string") throw new Error("not a wire event");
  return event;
}

export function scanWorkflowData(projectRoot: string): ScanResult {
  const result: ScanResult = { sessions: [], skipped: 0 };
  try {
    const chunksRoot = join(projectRoot, ".workflow-data", "streams", "chunks");
    if (!existsSync(chunksRoot)) return result;
    for (const streamDir of readdirSync(chunksRoot)) {
      try {
        const sessionId = recoverSessionId(streamDir);
        if (sessionId === undefined) { result.skipped++; continue; }
        const dir = join(chunksRoot, streamDir);
        // Ordering key per Task 2 probe: filename sort (ULIDs are
        // lexicographically sortable and monotonically increasing) — no
        // per-chunk ordering field exists in the manifest.
        const files = readdirSync(dir).sort();
        const events = files.map((f, position) => {
          const event = decodeChunk(readFileSync(join(dir, f)));
          return { position, event: stripMessageSoFar(event) };
        });
        if (!sessionHasUserActivity(events)) continue; // noise, not an error — not counted as skipped
        result.sessions.push({ sessionId, agent: recoverAgent(events), events });
      } catch {
        result.skipped++;
      }
    }
  } catch {
    /* whole-scan failure degrades to empty */
  }
  return result;
}

export function applyDiskScan(registry: Registry, projectRoot: string): ScanResult {
  const result = scanWorkflowData(projectRoot);
  for (const s of result.sessions) registry.ingestDisk(s.sessionId, s.events, { agent: s.agent });
  return result;
}
