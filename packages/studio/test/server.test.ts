import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRegistry } from "../src/registry.js";
import { startStudioServer, type StudioServer, writeSseFrame } from "../src/server.js";

let server: StudioServer | undefined;
afterEach(async () => { await server?.close(); server = undefined; });

async function boot() {
  server = await startStudioServer({ registry: createRegistry(), port: 0 });
  return server;
}

function envelope(sessionId: string, seq: number, type: string) {
  return { v: 1, project: { name: "p", root: "r" }, process: { instanceId: "i", kind: "unknown", pid: 1 }, agent: "a", sessionId, seq, hookEpoch: "e", event: { type } };
}

describe("collector server", () => {
  it("rejects non-loopback hosts before listening", async () => {
    await expect(startStudioServer({ registry: createRegistry(), port: 0, host: "0.0.0.0" })).rejects.toThrow("127.0.0.1");
  });

  it("health", async () => {
    const s = await boot();
    const res = await fetch(`${s.url}/health`);
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it("ingest -> sessions snapshot round trip", async () => {
    const s = await boot();
    const res = await fetch(`${s.url}/ingest`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ events: [envelope("s1", 0, "session.started"), envelope("s1", 1, "session.waiting")] }),
    });
    expect(res.status).toBe(204);
    const snap = await (await fetch(`${s.url}/api/sessions`)).json();
    expect(snap.sessions).toHaveLength(1);
    expect(snap.sessions[0].status).toBe("waiting");
    const detail = await (await fetch(`${s.url}/api/sessions/s1`)).json();
    expect(detail.events.map((e: { position: number }) => e.position)).toEqual([0, 1]);
    expect(detail).toHaveProperty("reducedState");           // Task 5: reduced conversation state
    expect(detail.reducedUpTo).toBe(2);
    expect(detail.diagnostics).toEqual([]);
  });

  it("survives malformed ingest bodies", async () => {
    const s = await boot();
    for (const body of ["not json", "{}", JSON.stringify({ events: "nope" }), JSON.stringify({ events: [null, 1, {}] })]) {
      const res = await fetch(`${s.url}/ingest`, { method: "POST", headers: { "content-type": "application/json" }, body });
      expect([204, 400]).toContain(res.status);
    }
    expect((await (await fetch(`${s.url}/health`)).json()).ok).toBe(true);
  });

  it("requires the JSON media type for ingest", async () => {
    const s = await boot();
    const missing = await fetch(`${s.url}/ingest`, { method: "POST" });
    const wrong = await fetch(`${s.url}/ingest`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ events: [] }),
    });

    expect(missing.status).toBe(415);
    expect(wrong.status).toBe(415);
  });

  it("rejects browser-originated ingest requests", async () => {
    const s = await boot();
    const res = await fetch(`${s.url}/ingest`, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8", origin: "https://attacker.example" },
      body: JSON.stringify({ events: [envelope("browser", 0, "session.started")] }),
    });

    expect(res.status).toBe(403);
    expect((await (await fetch(`${s.url}/api/sessions`)).json()).sessions).toHaveLength(0);
  });

  it("unknown route -> 404; missing session -> 404", async () => {
    const s = await boot();
    expect((await fetch(`${s.url}/nope`)).status).toBe(404);
    expect((await fetch(`${s.url}/api/sessions/ghost`)).status).toBe(404);
  });

  it("SSE: snapshot frame, then live update on ingest", async () => {
    const s = await boot();
    const res = await fetch(`${s.url}/api/stream`, { headers: { accept: "text/event-stream" } });
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    async function readUntil(marker: string, timeoutMs = 3_000): Promise<void> {
      const deadline = Date.now() + timeoutMs;
      while (!buffer.includes(marker)) {
        if (Date.now() > deadline) throw new Error(`SSE timeout waiting for ${marker}; got: ${buffer}`);
        const { value, done } = await reader.read();
        if (done) throw new Error("SSE closed early");
        buffer += decoder.decode(value, { stream: true });
      }
    }
    await readUntil("event: snapshot");
    await fetch(`${s.url}/ingest`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ events: [envelope("live-1", 0, "raw-body-must-not-stream")] }),
    });
    await readUntil("live-1");
    expect(buffer).toContain("event: update");
    expect(buffer).not.toContain("raw-body-must-not-stream");
    await reader.cancel();
  });

  it("port conflict rejects with EADDRINUSE", async () => {
    const s = await boot();
    await expect(startStudioServer({ registry: createRegistry(), port: s.port })).rejects.toMatchObject({ code: "EADDRINUSE" });
  });

  it("health carries meta versions when configured", async () => {
    server = await startStudioServer({
      registry: createRegistry(), port: 0,
      meta: { studioVersion: "0.1.0", eveVersion: "0.22.4" },
    });
    const body = await (await fetch(`${server.url}/health`)).json();
    expect(body.studioVersion).toBe("0.1.0");
    expect(body.eveVersion).toBe("0.22.4");
  });
});

describe("SSE backpressure", () => {
  it("ends a slow response when a frame cannot be buffered", () => {
    const response = {
      write: vi.fn(() => false),
      end: vi.fn(),
    };

    expect(writeSseFrame(response, "update", { kind: "event" })).toBe(false);
    expect(response.end).toHaveBeenCalledOnce();
  });
});

describe("static UI serving", () => {
  function uiFixture(): string {
    const tmp = mkdtempSync(join(tmpdir(), "studio-ui-"));
    const dir = join(tmp, "ui");
    mkdirSync(join(dir, "assets"), { recursive: true });
    writeFileSync(join(dir, "_shell.html"), "<!doctype html><title>Eve Studio</title>");
    writeFileSync(join(dir, "assets", "app.js"), "console.log(1)");
    writeFileSync(join(tmp, "secret.txt"), "TOP-SECRET");   // sibling of staticDir: must never be reachable
    return dir;
  }
  async function bootStatic() {
    server = await startStudioServer({ registry: createRegistry(), port: 0, staticDir: uiFixture() });
    return server;
  }

  it("serves the SPA shell at / and for client-routed paths", async () => {
    const s = await bootStatic();
    for (const path of ["/", "/sessions/wrun_x"]) {
      const res = await fetch(`${s.url}${path}`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/html");
      expect(await res.text()).toContain("Eve Studio");
    }
  });

  it("serves assets with their own content-type and 404s missing assets", async () => {
    const s = await bootStatic();
    const asset = await fetch(`${s.url}/assets/app.js`);
    expect(asset.status).toBe(200);
    expect(asset.headers.get("content-type")).toContain("text/javascript");
    expect((await fetch(`${s.url}/assets/nope.js`)).status).toBe(404);
  });

  it("API routes win over static; traversal never reaches outside the UI dir", async () => {
    const s = await bootStatic();
    const api = await fetch(`${s.url}/api/sessions`);
    expect(api.headers.get("content-type")).toContain("application/json");
    // The API namespace never falls through to the SPA shell
    expect((await fetch(`${s.url}/api/nope`)).status).toBe(404);
    const getIngest = await fetch(`${s.url}/ingest`);                // wrong method for /ingest
    expect(getIngest.status).toBe(404);
    expect(getIngest.headers.get("content-type")).toContain("application/json");
    // Two encodings of "../secret.txt". The WHATWG URL parser collapses %2e%2e dot
    // segments and normalize() resolves the decoded "..", so both must resolve INSIDE
    // the UI dir (-> missing asset, 404), and must never leak the sibling file.
    for (const path of ["/%2e%2e/secret.txt", "/..%2fsecret.txt"]) {
      const res = await fetch(`${s.url}${path}`);
      expect(res.status).toBe(404);
      expect(await res.text()).not.toContain("TOP-SECRET");
    }
  });

  it("without staticDir, GET / stays 404 (API-only mode unchanged)", async () => {
    const s = await boot();
    expect((await fetch(`${s.url}/`)).status).toBe(404);
  });
});
