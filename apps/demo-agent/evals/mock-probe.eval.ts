import { defineEval } from "eve/evals";

export default defineEval({
  description: "Plan B: two deterministic mock turns so the extension forwards a rich, free fixture",
  async test(t) {
    const first = await t.send("ping one");
    first.expectOk();
    const second = await t.send("ping two");
    second.expectOk();
  },
});
