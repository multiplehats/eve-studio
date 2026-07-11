import { defineTool } from "eve/tools";
import { z } from "zod";

/**
 * Returns the current time as an ISO-8601 timestamp. Pure, local, no I/O.
 */
export default defineTool({
  description:
    "Get the current date and time. Returns the current instant as an ISO-8601 UTC timestamp. Takes no input.",
  inputSchema: z.object({}),
  outputSchema: z.object({ iso: z.string() }),
  execute() {
    return { iso: new Date().toISOString() };
  },
});
