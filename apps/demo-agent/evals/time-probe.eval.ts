import { defineEval } from "eve/evals";

export default defineEval({
  description: "Real tool call: ask for the current time, forcing get_current_time",
  async test(t) {
    const turn = await t.send(
      "What time is it right now? Use your tool, then tell me in one sentence.",
    );
    turn.expectOk();
  },
});
