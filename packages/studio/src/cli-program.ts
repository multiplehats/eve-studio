import { Command } from "commander";

export type StudioCliOptions = {
  port?: string;
  project?: string;
  scanDisk: boolean;
  yes: boolean;
};

export function parseStudioPort(value: string | undefined): number | undefined {
  if (value === undefined) return 43110;
  if (!/^[0-9]+$/.test(value)) return undefined;
  const port = Number(value);
  return Number.isSafeInteger(port) && port >= 1 && port <= 65535 ? port : undefined;
}

export function invalidStudioPortMessage(value: string | undefined): string {
  return `invalid --port ${value}; expected a decimal integer from 1 to 65535`;
}

export function createStudioProgram(): Command {
  return new Command()
    .name("eve-studio")
    .description("Local observability workspace for eve agents")
    .showHelpAfterError()
    .option("--port <port>", "port to listen on", "43110")
    .option("--project <path>", "path to the Eve agent project to watch")
    .option("--scan-disk", "also ingest historical sessions from .workflow-data on startup", false)
    .option("-y, --yes", "auto-confirm the extension mount prompt", false);
}
