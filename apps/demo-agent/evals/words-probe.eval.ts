import { defineEval } from "eve/evals";

export default defineEval({
  description: "Real tool calls: count words then double via calculator (two tools)",
  async test(t) {
    const turn = await t.send(
      "Count the words in: 'the quick brown fox jumps over the lazy dog', then double that number with the calculator.",
    );
    turn.expectOk();
  },
});
