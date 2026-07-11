import { defineEval } from "eve/evals";

export default defineEval({
  description: "M0: drive one real turn so the extension hook fires under eve eval",
  async test(t) {
    const turn = await t.send("Reply with exactly the word PONG and nothing else.");
    turn.expectOk();
  },
});
