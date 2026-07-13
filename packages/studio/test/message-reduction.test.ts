import { describe, expect, it } from "vitest";
import { createMessageProjection } from "../src/message-reduction.js";

function appended(
  messageDelta: string,
  { turnId = "turn-1", stepIndex = 0, sequence = 0 } = {},
) {
  return {
    type: "message.appended",
    data: { messageDelta, turnId, stepIndex, sequence },
  };
}

function completed(
  message: string,
  { turnId = "turn-1", stepIndex = 0, sequence = 0 } = {},
) {
  return {
    type: "message.completed",
    data: { finishReason: "stop", message, turnId, stepIndex, sequence },
  };
}

function textParts(state: unknown): Array<{ text?: string; stepIndex?: number; state?: string }> {
  const messages = (state as { messages?: Array<{ parts?: Array<{ type?: string; text?: string; stepIndex?: number; state?: string }> }> }).messages ?? [];
  return messages.flatMap((message) => message.parts ?? []).filter((part) => part.type === "text");
}

describe("message projection", () => {
  it("projects cumulative live text from compact appended deltas", () => {
    const projection = createMessageProjection();
    let state = projection.initial();

    state = projection.reduce(state, appended("hello "));
    state = projection.reduce(state, appended("world"));

    expect(textParts(state)).toContainEqual(expect.objectContaining({ text: "hello world", state: "streaming" }));
  });

  it("keeps interleaved message identities independent", () => {
    const projection = createMessageProjection();
    let state = projection.initial();

    state = projection.reduce(state, appended("first ", { turnId: "turn-1", stepIndex: 0, sequence: 0 }));
    state = projection.reduce(state, appended("other", { turnId: "turn-1", stepIndex: 0, sequence: 1 }));
    state = projection.reduce(state, appended("done", { turnId: "turn-1", stepIndex: 0, sequence: 0 }));

    expect(JSON.stringify(state)).toContain("first done");
    expect(JSON.stringify(state)).not.toContain("otherdone");
  });

  it("clears an accumulator when its message completes", () => {
    const projection = createMessageProjection();
    let state = projection.initial();

    state = projection.reduce(state, appended("old"));
    state = projection.reduce(state, completed("old"));
    state = projection.reduce(state, appended("new"));

    expect(textParts(state)).toContainEqual(expect.objectContaining({ text: "new", state: "streaming" }));
  });

  it("passes malformed appended events through without synthesizing cumulative text", () => {
    const projection = createMessageProjection();
    const state = projection.reduce(projection.initial(), {
      type: "message.appended",
      data: { messageDelta: "ignored", messageSoFar: "kept", turnId: "turn-1", stepIndex: 0 },
    });

    expect(textParts(state)).toContainEqual(expect.objectContaining({ text: "kept" }));
  });

  it("starts a fresh projection without text accumulated by another instance", () => {
    const first = createMessageProjection();
    first.reduce(first.initial(), appended("old"));

    const fresh = createMessageProjection();
    const state = fresh.reduce(fresh.initial(), appended("new"));

    expect(JSON.stringify(state)).toContain("new");
    expect(JSON.stringify(state)).not.toContain("old");
  });
});
