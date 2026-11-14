export interface Message {
  id: string;
  /** Who wrote it: the person using the app, or the id of an agent. */
  from: "user" | string;
  /** Set when one agent wrote to another: the id of the agent it was for. */
  to?: string;
  text: string;
  /** When it was sent, in milliseconds since the epoch. */
  at: number;
}

/** One thing an agent did on the way to an answer, shown so it can be checked. */
export interface Step {
  id: string;
  /** The model's reasoning, or what came back from something it ran. */
  kind: "thinking" | "output";
  /** What produced an output, such as the command that was run. */
  source?: string;
  text: string;
  at: number;
}

/** Everything the app holds about one agent's work. */
export interface Work {
  messages: Message[];
  steps: Step[];
}

export const noWork: Work = { messages: [], steps: [] };

/** Each agent's work, by the agent's id. */
export type AllWork = Record<string, Work>;

export function userMessage(text: string): Message {
  return { id: crypto.randomUUID(), from: "user", text, at: Date.now() };
}
