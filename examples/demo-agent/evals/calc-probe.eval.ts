import { defineEval } from "eve/evals";

export default defineEval({
  description: "Real tool call: multiply two numbers, forcing the calculate tool",
  async test(t) {
    const turn = await t.send(
      "Compute 1847 * 23 with your calculator tool and give just the number.",
    );
    turn.expectOk();
  },
});
