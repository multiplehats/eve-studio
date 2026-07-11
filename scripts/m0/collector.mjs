import { createServer } from "node:http";
import { appendFileSync } from "node:fs";

const FILE = process.env.M0_COLLECTOR_FILE ?? "/tmp/eve-studio-m0-collector.ndjson";
createServer((req, res) => {
  if (req.method === "POST" && req.url === "/ingest") {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      appendFileSync(FILE, `${body}\n`);
      res.writeHead(204).end();
    });
    return;
  }
  if (req.url === "/health") return void res.writeHead(200).end("ok");
  res.writeHead(404).end();
}).listen(43118, "127.0.0.1", () => console.log("m0 collector on 43118"));
