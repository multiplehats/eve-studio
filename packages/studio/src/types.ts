export interface IngestEnvelope {           // tolerant view of Envelope v1; v/project/process may be absent
  v?: number;
  project?: { name?: string; root?: string };
  process?: { instanceId?: string; kind?: string; pid?: number };
  agent?: string;
  sessionId: string;
  channelKind?: string;
  group?: string;
  seq: number;
  hookEpoch: string;
  event: { type: string; data?: unknown };
}
export interface StoredEvent { position: number; source: "live" | "disk"; receivedAt: number; event: { type: string; data?: unknown } }
export interface ProjectionDiagnostic { position: number; eventType: string; message: string }
export type SessionStatus = "working" | "waiting" | "completed" | "failed";
export interface SessionUsage { inputTokens: number; outputTokens: number; costUsd: number; steps: number }
export interface SessionSummary {
  sessionId: string; agent: string;
  project: { name: string; root: string };
  processInstanceId: string; processKind: string;
  group: string;                          // envelope.group ?? processInstanceId
  channelKind?: string;
  eveVersion?: string;                    // from session.started (field path per DEVIATIONS §Plan B Task 2); Plan C's version-mismatch banner needs it collected NOW
  status: SessionStatus; usage: SessionUsage;
  eventCount: number; maxPosition: number; evictedBelow: number;
  degraded?: "epoch-reset" | "gap";
  updatedAt: number;
}
export type RegistryUpdate =
  | { kind: "event"; sessionId: string; position: number }
  | { kind: "session"; session: SessionSummary }
  | { kind: "session-removed"; sessionId: string };
export interface RegistryOptions { maxSessionBytes?: number; maxSessions?: number; now?: () => number; rebaseAfterMs?: number }   // default caps 5_000_000 bytes / 200 sessions; default rebaseAfterMs 3_000
export interface Registry {
  ingest(raw: unknown): void;                              // live path: tolerant, never throws
  ingestDisk(sessionId: string, events: Array<{ position: number; event: { type: string; data?: unknown } }>, meta?: { agent?: string; project?: { name: string; root: string } }): void;
  getSessions(): SessionSummary[];
  getSession(id: string): { summary: SessionSummary; events: StoredEvent[]; reducedState: unknown; reducedUpTo: number; diagnostics: ProjectionDiagnostic[]; diagnosticCount: number } | undefined;
  subscribe(fn: (u: RegistryUpdate) => void): () => void;
  stats(): { sessions: number; eventsAccepted: number; duplicatesDropped: number; malformedSkipped: number };
}
// ^ ALL interfaces above (including Registry and RegistryOptions) live in src/types.ts:
//   registry.ts, server.ts, and disk-scan.ts all import them from "./types.js".
