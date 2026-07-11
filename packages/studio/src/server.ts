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
    let size = 0;
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      size += (chunk as Buffer).length;
      if (size > MAX_BODY_BYTES) { json(res, 413, { error: "too large" }); req.resume(); return; }  // drain, don't destroy — destroying races the response onto a torn socket
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

  function handleStream(res: ServerResponse): void {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    send(res, "snapshot", { sessions: registry.getSessions() });
    sseClients.add(res);
    const unsubscribe = registry.subscribe((u: RegistryUpdate) => send(res, "update", u));
    const heartbeat = setInterval(() => res.write(": ping\n\n"), HEARTBEAT_MS);
    res.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
      sseClients.delete(res);
    });
  }

  function send(res: ServerResponse, event: string, data: unknown): void {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
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
