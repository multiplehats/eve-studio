import { defineEvalConfig } from "eve/evals";

// Required by eve 0.22.4: `eve eval` throws "Missing required eval config"
// without this file. No `judge` is set because the M0 probe eval uses no
// `t.judge.*` assertions (it only drives one turn and calls expectOk()).
export default defineEvalConfig({});
