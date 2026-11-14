import { Channel, invoke } from "@tauri-apps/api/core";
import type { Agent } from "./agents.ts";
import { describeFailure, presetOf, type Connection, type Failure } from "./connections.ts";
import type { Message } from "./conversation.ts";

/* Asking a model for a reply. The Rust side makes the request, with the
   connection's key, and hands back what the model writes as it writes it.
   The page never sees the key and never talks to a provider itself. */

/**
 * The connection whose model answers for an agent: the one chosen for it, or
 * the only one there is. With several and none chosen there is none, and none
 * if the chosen one has gone: which server reads a conversation is never a
 * guess.
 */
export function connectionFor(agent: Agent, connections: Connection[]): Connection | undefined {
  const ready = connections.filter((connection) => connection.model);
  if (agent.connection) return ready.find((connection) => connection.id === agent.connection);
  return ready.length === 1 ? ready[0] : undefined;
}

/** Why `connectionFor` found nothing, and what to do about it. */
export function whyNoConnection(agent: Agent, connections: Connection[]): string {
  if (!connections.some((connection) => connection.model)) {
    return "No model is connected yet. Connect one in Settings, under Models.";
  }
  return agent.connection
    ? `The model chosen for ${agent.name} is no longer connected. Choose another under Edit agent.`
    : `More than one model is connected. Choose which answers for ${agent.name} under Edit agent.`;
}

/** One side's part of a conversation, as a model is sent it. */
export interface Turn {
  role: "user" | "assistant";
  content: string;
}

/**
 * What a model is sent of an agent's conversation: what the person wrote and
 * what the agent answered them. What agents wrote to each other is left out,
 * and so is a reply with nothing in it. Messages in a row from one side are
 * joined, because some models only take turns that alternate.
 */
export function turnsOf(messages: Message[], agentId: string): Turn[] {
  const turns: Turn[] = [];
  for (const message of messages) {
    const mine = message.from === agentId && message.to === undefined;
    if (!message.text || (message.from !== "user" && !mine)) continue;
    const role = mine ? "assistant" : "user";
    const last = turns.at(-1);
    if (last?.role === role) last.content += `\n\n${message.text}`;
    else turns.push({ role, content: message.text });
  }
  return turns;
}

/** A reply while it is being written. */
export interface Reply {
  /** Settles when the reply has ended. It rejects, with a `Failure`, if the
      reply did not get to its end. */
  done: Promise<void>;
  /** Ends the reply where it stands. Not a failure: `done` then resolves. */
  stop(): void;
}

type Piece = { kind: "thinking" | "text"; text: string } | { kind: "end"; failure?: Failure };

/**
 * Asks a connection's model to answer a conversation. `onProgress` is given
 * all of the answer and all of the reasoning so far, at most once for each
 * frame drawn, and one last time before `done` settles.
 */
export function ask(
  connection: Connection,
  turns: Turn[],
  onProgress: (text: string, thinking: string) => void,
): Reply {
  // The name the Rust side knows this reply by, for stopping it.
  const request = crypto.randomUUID();
  let text = "";
  let thinking = "";
  let frame = 0;
  let over = false;
  let end = (_failure?: unknown) => {};
  const done = new Promise<void>((resolve, reject) => {
    end = (failure) => {
      if (over) return;
      over = true;
      cancelAnimationFrame(frame);
      onProgress(text, thinking);
      if (failure === undefined) resolve();
      else reject(failure);
    };
  });
  // How the reply ended arrives here too, as the last piece: an answer to
  // the call itself could overtake the pieces before it.
  const pieces = new Channel<Piece>((piece) => {
    if (over) return;
    if (piece.kind === "end") return end(piece.failure);
    if (piece.kind === "thinking") thinking += piece.text;
    else text += piece.text;
    frame ||= requestAnimationFrame(() => {
      frame = 0;
      onProgress(text, thinking);
    });
  });
  invoke("chat_send", {
    request,
    id: connection.id,
    address: connection.address,
    model: connection.model,
    turns,
    needsKey: presetOf(connection.preset).key === "needed",
    pieces,
  }).catch((error) => end(error ?? {}));
  return {
    done,
    stop() {
      if (over) return;
      end();
      // If this fails, the reply runs to its end unheard.
      invoke("chat_stop", { request }).catch(() => {});
    },
  };
}

/** Why a reply did not get to its end, in words a person can act on. */
export function describeReplyFailure(failure: unknown): string {
  const kind = typeof failure === "object" && failure !== null ? (failure as Partial<Failure>).kind : undefined;
  switch (kind) {
    case "refused":
      return "This connection's key was not accepted, or is missing. Check it in Settings.";
    case "request":
      return "The server would not take the conversation. It may have grown too long for this model.";
    case "missing":
      return "The server has no such model at that address. Check the connection in Settings.";
    case "timeout":
      return "The model went quiet for too long, so Snowpaw stopped waiting.";
    case "interrupted":
      return "The reply was cut off before it was finished.";
    case "long":
      return "The reply went on for too long, so Snowpaw stopped reading it.";
    default:
      return describeFailure(failure);
  }
}
