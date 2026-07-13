import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

import {
  createRegistry,
  startStudioServer,
} from "../packages/studio/dist/index.js";

const UI_DIR = fileURLToPath(
  new URL("../packages/studio/dist/ui", import.meta.url),
);
const FIXTURE_PATH = new URL(
  "../packages/studio/test/fixtures/mock-eval-envelopes.ndjson",
  import.meta.url,
);
const CRITICAL_RESOURCE_TYPES = new Set([
  "document",
  "script",
  "stylesheet",
  "xhr",
  "fetch",
  "eventsource",
]);

const fixture = readFileSync(FIXTURE_PATH, "utf8")
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => JSON.parse(line));

if (fixture.length === 0 || typeof fixture[0]?.sessionId !== "string") {
  throw new Error("mock eval fixture does not contain a session");
}

const sessionId = fixture[0].sessionId;
if (!fixture.every((envelope) => envelope.sessionId === sessionId)) {
  throw new Error("mock eval fixture must contain exactly one session");
}

let studio;
let browser;

try {
  studio = await startStudioServer({
    registry: createRegistry(),
    port: 0,
    staticDir: UI_DIR,
    meta: { studioVersion: "browser-smoke", eveVersion: "0.22.4" },
  });

  const ingest = await fetch(`${studio.url}/ingest`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ events: fixture }),
  });
  if (!ingest.ok)
    throw new Error(`fixture ingest failed with HTTP ${ingest.status}`);

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const browserFailures = [];
  const studioOrigin = new URL(studio.url).origin;
  let navigationMayAbortRequests = false;

  page.on("pageerror", (error) =>
    browserFailures.push(`pageerror: ${error.message}`),
  );
  page.on("console", (message) => {
    if (message.type() === "error")
      browserFailures.push(`console.error: ${message.text()}`);
  });
  page.on("response", (response) => {
    if (
      response.status() >= 400 &&
      response.url().startsWith(studio.url) &&
      CRITICAL_RESOURCE_TYPES.has(response.request().resourceType())
    ) {
      browserFailures.push(
        `${response.status()} ${response.request().resourceType()}: ${response.url()}`,
      );
    }
  });
  page.on("requestfailed", (request) => {
    const failure = request.failure()?.errorText ?? "unknown network failure";
    let sameOrigin = false;
    try {
      sameOrigin = new URL(request.url()).origin === studioOrigin;
    } catch {
      /* malformed request URLs are not Studio resources */
    }
    if (
      sameOrigin &&
      CRITICAL_RESOURCE_TYPES.has(request.resourceType()) &&
      !(navigationMayAbortRequests && failure === "net::ERR_ABORTED")
    ) {
      browserFailures.push(
        `requestfailed ${request.resourceType()}: ${request.url()} (${failure})`,
      );
    }
  });

  const directUrl = `${studio.url}/sessions/${encodeURIComponent(sessionId)}`;

  async function assertSessionLoaded(label) {
    const header = page.locator("header");
    await header.waitFor({ state: "visible", timeout: 10_000 });
    await header
      .getByText("demo-agent", { exact: true })
      .waitFor({ state: "visible", timeout: 10_000 });
    await page
      .getByText("MOCK[1]: ping one", { exact: true })
      .waitFor({ state: "visible", timeout: 10_000 });
    await page
      .getByText("MOCK[2]: ping two", { exact: true })
      .waitFor({ state: "visible", timeout: 10_000 });

    const loadingCount = await page
      .getByText("Loading session…", { exact: true })
      .count();
    if (loadingCount !== 0)
      throw new Error(
        `${label}: persistent loading indicator remained in the DOM`,
      );
  }

  await page.goto(directUrl, { waitUntil: "domcontentloaded" });
  await assertSessionLoaded("cold navigation");

  navigationMayAbortRequests = true;
  await page.reload({ waitUntil: "domcontentloaded" });
  navigationMayAbortRequests = false;
  await assertSessionLoaded("reload");

  if (browserFailures.length > 0) {
    throw new Error(
      `browser failures:\n${browserFailures.map((failure) => `- ${failure}`).join("\n")}`,
    );
  }

  console.log(
    JSON.stringify(
      {
        directSessionNavigation: true,
        reload: true,
        messages: ["MOCK[1]: ping one", "MOCK[2]: ping two"],
        browserFailures: 0,
      },
      null,
      2,
    ),
  );
} finally {
  await browser?.close().catch(() => {});
  await studio?.close().catch(() => {});
}
