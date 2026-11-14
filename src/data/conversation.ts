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

/** Everything the app holds about one agent's work. */
export interface Work {
  messages: Message[];
}

export const noWork: Work = { messages: [] };

/** Each agent's work, by the agent's id. */
export type AllWork = Record<string, Work>;

export function userMessage(text: string): Message {
  return { id: crypto.randomUUID(), from: "user", text, at: Date.now() };
}
