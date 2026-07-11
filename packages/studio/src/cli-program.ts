import { Command } from "commander";

export type StudioCliOptions = {
  port?: string;
  project?: string;
  scanDisk: boolean;
  yes: boolean;
};

export function createStudioProgram(): Command {
  return new Command()
    .name("eve-studio")
    .description("Zero-config observability UI for Eve agents")
    .showHelpAfterError()
    .option("--port <port>", "port to listen on", "43110")
    .option("--project <path>", "path to the Eve agent project to watch")
    .option("--scan-disk", "also ingest historical sessions from .workflow-data on startup", false)
    .option("-y, --yes", "auto-confirm the extension mount prompt", false);
}
