import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import type { Registry, RegistryUpdate } from "./types.js";

export interface StudioServerOptions {
  registry: Registry; port: number; host?: string;
  meta?: { studioVersion: string; eveVersion: string };
  /** Directory holding the built SPA (dist/client): _shell.html + assets/. When set, unmatched GETs serve from it. */
  staticDir?: string;
}
export interface StudioServer { url: string; port: number; close(): Promise<void> }

const MAX_BODY_BYTES = 32 * 1024 * 1024;
const HEARTBEAT_MS = 15_000;
const INITIAL_DRAIN_TIMEOUT_MS = 1_000;
const MAX_PENDING_UPDATES = 1_000;

export interface SseWritable {
  write(chunk: string): boolean;
  end(): void;
}

export interface SseStreamWritable extends SseWritable {
  writeHead(statusCode: number, headers: Record<string, string>): void;
  on(event: "close", listener: () => void): unknown;
  once(event: "close" | "drain", listener: () => void): unknown;
  off(event: "close" | "drain", listener: () => void): unknown;
  readonly writableEnded?: boolean;
}

export interface SseStreamOptions {
  heartbeatMs?: number;
  initialDrainTimeoutMs?: number;
  maxPendingUpdates?: number;
  onDisconnect?: () => void;
}

function writeSseChunk(res: SseWritable, chunk: string): boolean {
  if (res.write(chunk)) return true;
  res.end();
  return false;
}

export function writeSseFrame(res: SseWritable, event: string, data: unknown): boolean {
  return writeSseChunk(res, `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function writeInitialSseFrame(
  res: SseStreamWritable,
  event: string,
  data: unknown,
  timeoutMs: number,
): Promise<boolean> {
  const chunk = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  if (res.writableEnded) return Promise.resolve(false);

  return new Promise((resolve) => {
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const finish = (drained: boolean) => {
      if (settled) return;
      settled = true;
      if (timeout !== undefined) clearTimeout(timeout);
      res.off("drain", onDrain);
      res.off("close", onClose);
      resolve(drained);
    };
    const onDrain = () => finish(true);
    const onClose = () => finish(false);

    // Register before write(): a custom writable is allowed to emit either
    // event synchronously while processing the chunk.
    res.once("drain", onDrain);
    res.once("close", onClose);
    if (res.write(chunk)) {
      finish(true);
      return;
    }
    if (settled) return;
    timeout = setTimeout(() => finish(false), timeoutMs);
    timeout.unref?.();
  });
}

export async function openSseStream(
  registry: Registry,
  res: SseStreamWritable,
  options: SseStreamOptions = {},
): Promise<void> {
  const heartbeatMs = options.heartbeatMs ?? HEARTBEAT_MS;
  const initialDrainTimeoutMs = options.initialDrainTimeoutMs ?? INITIAL_DRAIN_TIMEOUT_MS;
  const maxPendingUpdates = options.maxPendingUpdates ?? MAX_PENDING_UPDATES;

  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });

  let active = true;
  let ready = false;
  let overflowed = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let unsubscribe = () => {};
  const pending: RegistryUpdate[] = [];
  const disconnect = (end = true) => {
    if (!active) return;
    active = false;
    if (heartbeat !== undefined) clearInterval(heartbeat);
    unsubscribe();
    options.onDisconnect?.();
    if (end && !res.writableEnded) res.end();
  };
  const send = (event: string, data: unknown) => {
    if (!active) return;
    try {
      if (!writeSseFrame(res, event, data)) disconnect();
    } catch {
      disconnect();
    }
  };

  res.on("close", () => disconnect(false));

  // Capture first, then subscribe synchronously. Updates that happen while
  // the initial write drains are replayed after the snapshot in order.
  const snapshot = { sessions: registry.getSessions() };
  unsubscribe = registry.subscribe((update) => {
    if (!active) return;
    if (ready) {
      send("update", update);
      return;
    }
    if (pending.length >= maxPendingUpdates) {
      overflowed = true;
      return;
    }
    pending.push(update);
  });

  const initialized = await writeInitialSseFrame(
    res,
    "snapshot",
    snapshot,
    initialDrainTimeoutMs,
  );
  if (!active) return;
  if (!initialized || overflowed) {
    disconnect();
    return;
  }

  ready = true;
  for (const update of pending) {
    send("update", update);
    if (!active) return;
  }
  pending.length = 0;
  heartbeat = setInterval(() => {
    if (active && !writeSseChunk(res, ": ping\n\n")) disconnect();
  }, heartbeatMs);
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2",
};

export function startStudioServer(opts: StudioServerOptions): Promise<StudioServer> {
  const { registry } = opts;
  const host = opts.host ?? "127.0.0.1";
  if (host !== "127.0.0.1") {
    return Promise.reject(new Error("eve-studio only listens on 127.0.0.1"));
  }
  const sseClients = new Set<ServerResponse>();

  const server = createServer((req, res) => {
    void route(req, res).catch(() => {
      if (!res.headersSent) json(res, 500, { error: "internal" });
      else res.end();
    });
  });

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", `http://${host}`);
    if (req.method === "GET" && url.pathname === "/health") {
      return json(res, 200, { ok: true, name: "eve-studio", sessions: registry.getSessions().length, ...opts.meta });
    }
    if (req.method === "POST" && url.pathname === "/ingest") return handleIngest(req, res);
    if (req.method === "GET" && url.pathname === "/api/sessions") {
      return json(res, 200, { sessions: registry.getSessions() });
    }
    if (req.method === "GET" && url.pathname.startsWith("/api/sessions/")) {
      const id = decodeURIComponent(url.pathname.slice("/api/sessions/".length));
      const rec = registry.getSession(id);
      return rec ? json(res, 200, rec) : json(res, 404, { error: "not found" });
    }
    if (req.method === "GET" && url.pathname === "/api/stream") return handleStream(res);
    const isApiPath = url.pathname === "/ingest" || url.pathname.startsWith("/api/");
    if (req.method === "GET" && opts.staticDir !== undefined && !isApiPath) return serveStatic(res, opts.staticDir, url.pathname);
    return json(res, 404, { error: "not found" });
  }

  async function handleIngest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.headers.origin !== undefined) {
      req.resume();
      return json(res, 403, { error: "browser origins are not allowed" });
    }
    const mediaType = req.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
    if (mediaType !== "application/json") {
      req.resume();
      return json(res, 415, { error: "application/json required" });
    }
    let size = 0;
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      size += (chunk as Buffer).length;
      if (size > MAX_BODY_BYTES) { json(res, 413, { error: "too large" }); req.resume(); return; }  // drain, don't destroy: destroying races the response onto a torn socket
      chunks.push(chunk as Buffer);
    }
    let parsed: unknown;
    try { parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { return json(res, 400, { error: "bad json" }); }
    const events = (parsed as { events?: unknown })?.events;
    if (Array.isArray(events)) for (const e of events) registry.ingest(e);
    res.writeHead(204).end();
  }

  async function serveStatic(res: ServerResponse, dir: string, pathname: string): Promise<void> {
    let rel: string;
    try { rel = normalize(decodeURIComponent(pathname)).replace(/^[/\\]+/, ""); }
    catch { return json(res, 404, { error: "not found" }); }        // malformed percent-encoding
    const target = rel === "" ? join(dir, "_shell.html") : join(dir, rel);
    if (target !== join(dir, "_shell.html") && !target.startsWith(dir + sep)) {
      return json(res, 404, { error: "not found" });       // traversal escaped the UI dir
    }
    try {
      const body = await readFile(target);
      res.writeHead(200, { "content-type": MIME[extname(target)] ?? "application/octet-stream" }).end(body);
    } catch {
      if (extname(rel) !== "") return json(res, 404, { error: "not found" });   // a real asset is missing
      try {
        const shell = await readFile(join(dir, "_shell.html"));                  // client-routed path -> SPA shell
        res.writeHead(200, { "content-type": MIME[".html"] }).end(shell);
      } catch {
        json(res, 404, { error: "not found" });
      }
    }
  }

  async function handleStream(res: ServerResponse): Promise<void> {
    sseClients.add(res);
    try {
      await openSseStream(registry, res, {
        onDisconnect: () => sseClients.delete(res),
      });
    } catch (error) {
      sseClients.delete(res);
      throw error;
    }
  }

  function json(res: ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  }

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port, host, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : opts.port;
      resolve({
        url: `http://${host}:${port}`,
        port,
        close: () =>
          new Promise((r) => {
            for (const c of sseClients) c.end();
            server.close(() => r());
          }),
      });
    });
  });
}
