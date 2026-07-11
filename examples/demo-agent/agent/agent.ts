import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { mockModel } from "eve/evals";
import { defineAgent } from "eve";

const OPENROUTER_MODEL = process.env.DEMO_MODEL ?? "openai/gpt-4o-mini";

/**
 * EVE_STUDIO_MOCK=1 swaps in eve's deterministic mock model so evals run with
 * no API key and no cost. The responder is prompt-aware so multi-turn evals
 * produce distinct, assertable text.
 */
const model = process.env.EVE_STUDIO_MOCK === "1"
  ? mockModel(({ lastUserMessage, userMessageCount }) => `MOCK[${userMessageCount}]: ${lastUserMessage}`)
  : process.env.OPENROUTER_API_KEY
    ? createOpenAICompatible({
        name: "openrouter",
        baseURL: "https://openrouter.ai/api/v1",
        apiKey: process.env.OPENROUTER_API_KEY,
        includeUsage: true,
      })(OPENROUTER_MODEL)
    : "anthropic/claude-sonnet-5";

export default defineAgent({
  model,
  modelContextWindowTokens: 200_000,
});
