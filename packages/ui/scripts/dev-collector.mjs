// Dev-only: replays the recorded mock-eval fixture through the REAL eve-studio
// server on 43110 so `pnpm dev` (43120) has data behind its /api proxy.
// Zero paid calls: the fixture was recorded once under EVE_STUDIO_MOCK=1.
// Requires `pnpm --filter eve-studio build` first (imports eve-studio's dist).
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { createRegistry, startStudioServer } from "eve-studio"

const fixture = fileURLToPath(new URL("../../studio/test/fixtures/mock-eval-envelopes.ndjson", import.meta.url))
// The eve pin's single source of truth is packages/studio/package.json dependencies.eve.
const evePin = JSON.parse(readFileSync(fileURLToPath(new URL("../../studio/package.json", import.meta.url)), "utf8")).dependencies.eve
const registry = createRegistry()
for (const line of readFileSync(fixture, "utf8").trim().split("\n")) registry.ingest(JSON.parse(line))
const server = await startStudioServer({
  registry, port: 43110,
  meta: { studioVersion: "dev", eveVersion: evePin },
})
console.log(`dev-collector: ${registry.getSessions().length} fixture session(s) on ${server.url}`)
console.log("dev-collector: now run `pnpm dev` in packages/ui and open http://127.0.0.1:43120")
