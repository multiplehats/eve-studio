import { defineTool } from "eve/tools";
import { z } from "zod";

/**
 * Counts whitespace-delimited words in a string. Pure, local, no I/O.
 */
export default defineTool({
  description:
    "Count the number of words in a piece of text. Words are runs of non-whitespace characters separated by whitespace.",
  inputSchema: z.object({ text: z.string() }),
  outputSchema: z.object({ count: z.number().int() }),
  execute({ text }) {
    const trimmed = text.trim();
    const count = trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
    return { count };
  },
});
