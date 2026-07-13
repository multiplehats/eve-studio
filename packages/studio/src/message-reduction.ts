import { defaultMessageReducer } from "eve/client";

export interface MessageProjection {
  initial(): unknown;
  reduce(state: unknown, event: { type: string; data?: unknown }): unknown;
}

interface MessageIdentity {
  turnId: string;
  stepIndex: number;
  sequence: number;
}

function identity(data: unknown): MessageIdentity | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  const value = data as Record<string, unknown>;
  if (
    typeof value.turnId !== "string"
    || !Number.isInteger(value.stepIndex)
    || !Number.isInteger(value.sequence)
  ) return undefined;
  return {
    turnId: value.turnId,
    stepIndex: value.stepIndex as number,
    sequence: value.sequence as number,
  };
}

function identityKey(value: MessageIdentity): string {
  return JSON.stringify([value.turnId, value.stepIndex, value.sequence]);
}

export function createMessageProjection(): MessageProjection {
  const reducer = defaultMessageReducer();
  const accumulated = new Map<string, string>();

  return {
    initial(): unknown {
      accumulated.clear();
      return reducer.initial();
    },

    reduce(state, event): unknown {
      const messageIdentity = identity(event.data);

      if (event.type === "message.appended" && messageIdentity !== undefined) {
        const data = event.data as Record<string, unknown>;
        if (typeof data.messageDelta === "string") {
          const key = identityKey(messageIdentity);
          const messageSoFar = (accumulated.get(key) ?? "") + data.messageDelta;
          accumulated.set(key, messageSoFar);
          return reducer.reduce(state as never, {
            ...event,
            data: { ...data, messageSoFar },
          } as never);
        }
      }

      const reduced = reducer.reduce(state as never, event as never);
      if (event.type === "message.completed" && messageIdentity !== undefined) {
        accumulated.delete(identityKey(messageIdentity));
      }
      return reduced;
    },
  };
}
