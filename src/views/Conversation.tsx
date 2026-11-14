import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Avatar } from "../components/Avatar";
import { IconButton } from "../components/IconButton";
import { initials, maxPinned, type Agent } from "../data/agents";
import { Button } from "../components/Button";
import { isMoment, taskLine, type Message } from "../data/conversation";
import styles from "./Conversation.module.css";

interface Props {
  agent: Agent;
  /** Every agent, to put a name and a face to messages from other agents. */
  agents: Agent[];
  /** The person using the app, to put a face to what they wrote. */
  user: { name: string; picture?: string };
  messages: Message[];
  /** False when the pin limit is reached and this agent is not pinned. */
  canPin: boolean;
  /** Whether the agent's panel is showing beside the conversation. */
  panelOpen: boolean;
  onTogglePanel: () => void;
  /** The window's buttons, when this view is the one in the window's corner. */
  windowButtons: ReactNode;
  onSend: (text: string) => void;
  /** Agrees to the task a message proposed, as proposed. */
  onSchedule: (message: Message) => void;
  /** Opens that task to be changed first. */
  onEditProposal: (message: Message) => void;
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

export function Conversation(props: Props) {
  const { agent, agents, user, messages, canPin, onSend, onTogglePin, onEdit } = props;
  const [draft, setDraft] = useState("");
  const end = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(props.panelOpen);

  // Focus went into the panel when it opened. When it closes, focus comes
  // back to the button that opens it. That waits for the next frame: in a
  // narrow window the conversation was hidden behind the panel, and it can
  // only take focus once the page has been laid out without the panel.
  useEffect(() => {
    const closed = wasOpen.current && !props.panelOpen;
    wasOpen.current = props.panelOpen;
    if (!closed) return;
    const frame = requestAnimationFrame(() => opener.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [props.panelOpen]);

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
      <header className={styles.header} data-window-drag>
        <span className={styles.balance} />
        <h1 className={styles.heading}>
          <button
            ref={opener}
            className={styles.who}
            aria-expanded={props.panelOpen}
            title={props.panelOpen ? "Hide what this agent is doing" : "Show what this agent is doing"}
            onClick={props.onTogglePanel}
          >
            <Avatar who={agent} size="sm" />
            <span className={styles.name}>{agent.name}</span>
          </button>
        </h1>
        <div className={styles.actions}>
          {/* At the limit the button stays reachable, so that what it says can be read. */}
          <IconButton
            icon="pin"
            label={
              agent.pinned ? "Unpin" : canPin ? "Pin" : `Only ${maxPinned} agents can be pinned`
            }
            aria-pressed={agent.pinned}
            aria-disabled={!canPin}
            onClick={canPin ? onTogglePin : undefined}
          />
          <IconButton icon="edit" label="Edit agent" onClick={onEdit} />
          {props.windowButtons}
        </div>
      </header>

      {/* It can take focus so that the keyboard can scroll it: no scrollbar is drawn. */}
      <div className={styles.messages} tabIndex={0} role="group" aria-label="Messages">
        {messages.length === 0 && (
          <p className={styles.empty}>Nothing here yet. Say what you want {agent.name} to do.</p>
        )}
        {messages.map((message, index) => {
          const previous = messages[index - 1];
          const next = messages[index + 1];
          const mine = message.from === "user";
          // A message that is not to or from the person: one agent writing to another.
          const between = !mine && (message.from !== agent.id || message.to !== undefined);
          // As in a group chat, a face goes beside the last of a run of
          // messages from the same sender to the same reader.
          const sameRun = (other: Message | undefined) =>
            other !== undefined &&
            other.from === message.from &&
            other.to === message.to &&
            Math.abs(other.at - message.at) <= quietGap;
          const lastOfRun = !sameRun(next);
          return (
            <div key={message.id} className={sameRun(previous) ? styles.entry : styles.turn}>
              {(!previous || message.at - previous.at > quietGap) && (
                <time className={styles.time} dateTime={new Date(message.at).toISOString()}>
                  {clock.format(message.at)}
                </time>
              )}
              {between && (
                <span className={styles.sender}>
                  {name(message.from)} to {message.to ? name(message.to) : "you"}
                </span>
              )}
              <div className={mine ? styles.mineRow : styles.row}>
                <span className={styles.face}>
                  {lastOfRun &&
                    (mine ? (
                      <Avatar who={user} initials={initials(user.name)} size="md" />
                    ) : (
                      <Avatar who={agents.find((other) => other.id === message.from) ?? {}} size="md" />
                    ))}
                </span>
                <p className={mine ? styles.mine : between ? styles.between : styles.theirs}>
                  {/* Who wrote it, for those who cannot see which side it is
                      on. Between agents, the line above already says. */}
                  {!between && <span className={styles.unseen}>{mine ? "You" : agent.name}: </span>}
                  {message.text}
                </p>
              </div>
              {message.proposal && (
                <div className={styles.proposal}>
                  <p className={styles.status}>
                    {message.proposal.scheduled ? "Scheduled" : "Needs your OK"}
                  </p>
                  <p className={styles.task}>{message.proposal.task.title}</p>
                  <p className={styles.status}>{taskLine(message.proposal.task)}</p>
                  {!message.proposal.scheduled && (
                    <div className={styles.choices}>
                      <Button
                        primary
                        disabled={!isMoment(message.proposal.task.at)}
                        onClick={() => props.onSchedule(message)}
                      >
                        Schedule it
                      </Button>
                      <Button onClick={() => props.onEditProposal(message)}>Edit first</Button>
                    </div>
                  )}
                </div>
              )}
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
