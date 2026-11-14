import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Avatar } from "../components/Avatar";
import { IconButton } from "../components/IconButton";
import { maxPinned, type Agent } from "../data/agents";
import type { Message } from "../data/conversation";
import styles from "./Conversation.module.css";

interface Props {
  agent: Agent;
  /** Every agent, to put a name and a face to messages from other agents. */
  agents: Agent[];
  messages: Message[];
  /** False when the pin limit is reached and this agent is not pinned. */
  canPin: boolean;
  onSend: (text: string) => void;
  onTogglePin: () => void;
  onEdit: () => void;
}

/** A gap this long between two messages gets the time written between them. */
const quietGap = 30 * 60 * 1000;

const clock = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  hour: "numeric",
  minute: "2-digit",
});

export function Conversation({ agent, agents, messages, canPin, onSend, onTogglePin, onEdit }: Props) {
  const [draft, setDraft] = useState("");
  const end = useRef<HTMLDivElement>(null);

  // Keep the newest message in view, and start at the bottom of a conversation.
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [agent.id, messages.length]);

  function send(event?: FormEvent) {
    event?.preventDefault();
    const text = draft.trim();
    if (!text) return;
    onSend(text);
    setDraft("");
  }

  function onKeyDown(event: KeyboardEvent) {
    // Enter sends and Shift+Enter starts a new line. Enter while an input
    // method is composing a character belongs to the input method.
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) send(event);
  }

  const name = (id: string) => agents.find((other) => other.id === id)?.name ?? "A deleted agent";

  return (
    <div className={styles.conversation}>
      <header className={styles.header}>
        <span className={styles.who}>
          <Avatar agent={agent} size="sm" />
          <h1 className={styles.name}>{agent.name}</h1>
        </span>
        <div className={styles.actions}>
          <IconButton
            icon="pin"
            label={
              agent.pinned ? "Unpin" : canPin ? "Pin" : `Only ${maxPinned} agents can be pinned`
            }
            aria-pressed={agent.pinned}
            disabled={!canPin}
            onClick={onTogglePin}
          />
          <IconButton icon="edit" label="Edit agent" onClick={onEdit} />
        </div>
      </header>

      <div className={styles.messages}>
        {messages.length === 0 && (
          <p className={styles.empty}>Nothing here yet. Say what you want {agent.name} to do.</p>
        )}
        {messages.map((message, index) => {
          const previous = messages[index - 1];
          const mine = message.from === "user";
          // A message that is not to or from the person: one agent writing to another.
          const between = !mine && (message.from !== agent.id || message.to !== undefined);
          return (
            <div key={message.id} className={styles.entry}>
              {(!previous || message.at - previous.at > quietGap) && (
                <time className={styles.time} dateTime={new Date(message.at).toISOString()}>
                  {clock.format(message.at)}
                </time>
              )}
              {between && (
                <span className={styles.sender}>
                  <Avatar agent={agents.find((other) => other.id === message.from) ?? agent} size="sm" />
                  {name(message.from)} to {message.to ? name(message.to) : "you"}
                </span>
              )}
              <p className={mine ? styles.mine : between ? styles.between : styles.theirs}>
                {message.text}
              </p>
            </div>
          );
        })}
        <div ref={end} />
      </div>

      <form className={styles.composer} onSubmit={send}>
        <textarea
          className={styles.draft}
          rows={1}
          value={draft}
          placeholder={`Message ${agent.name}`}
          aria-label={`Message ${agent.name}`}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <IconButton primary type="submit" icon="send" label="Send" disabled={!draft.trim()} />
      </form>
    </div>
  );
}
