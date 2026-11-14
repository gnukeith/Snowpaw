export interface Message {
  id: string;
  /** Who wrote it: the person using the app, or the id of an agent. */
  from: "user" | string;
  /** Set when one agent wrote to another: the id of the agent it was for. */
  to?: string;
  text: string;
  /** When it was sent, in milliseconds since the epoch. */
  at: number;
  /** A task the agent wants to schedule without having been asked to. */
  proposal?: Proposal;
  /** Set while a model is still writing it. */
  pending?: boolean;
  /** Why it ended before it was finished, in words for the person reading. */
  failure?: string;
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

/** Something an agent will do later, or will remind the user of. */
export interface Task {
  id: string;
  kind: "task" | "reminder";
  title: string;
  /** When it is next due, in milliseconds since the epoch. */
  at: number;
  /** How often it comes round again, in words. A one-off has none. */
  repeats?: string;
}

/** A task as it is before it is scheduled: everything but its id. */
export type TaskDraft = Omit<Task, "id">;

/**
 * A task an agent thinks is worth scheduling. Agents act without asking, with
 * this one exception: work that keeps coming round is only set up on the
 * agent's own initiative once the user has agreed to it.
 */
export interface Proposal {
  task: TaskDraft;
  /** Set once the user has agreed, with or without changing it first. */
  scheduled: boolean;
}

/** Everything the app holds about one agent's work. */
export interface Work {
  messages: Message[];
  steps: Step[];
  /** Every change the agent made to files, as one unified diff. */
  diff: string;
  tasks: Task[];
}

export const noWork: Work = { messages: [], steps: [], diff: "", tasks: [] };

/** Each agent's work, by the agent's id. Read it through `workOf`. */
export type AllWork = Record<string, Work>;

/** One agent's work. An id is text from storage, so it could be the name of
    something every object inherits, such as "constructor": only an entry that
    was really put there counts. */
export function workOf(all: AllWork, id: string): Work {
  return Object.hasOwn(all, id) ? all[id] : noWork;
}

export function userMessage(text: string): Message {
  return { id: crypto.randomUUID(), from: "user", text, at: Date.now() };
}

/** A reply about to be written by an agent's model: empty, and pending. */
export function pendingReply(agentId: string): Message {
  return { id: crypto.randomUUID(), from: agentId, text: "", at: Date.now(), pending: true };
}

/**
 * A reply as far as its model has written it: the answer in the message, and
 * the reasoning that led to it as a step under the same id, so the one can be
 * checked against the other. A reply that is no longer pending, or no longer
 * there, is left alone: what arrives late for it is dropped.
 */
export function writeReply(work: Work, id: string, text: string, thinking: string): Work {
  const message = work.messages.find((other) => other.id === id);
  if (!message?.pending) return work;
  const step: Step = { id, kind: "thinking", text: thinking, at: message.at };
  const known = work.steps.some((other) => other.id === id);
  return {
    ...work,
    messages: work.messages.map((other) => (other === message ? { ...message, text } : other)),
    steps: !thinking
      ? work.steps
      : known
        ? work.steps.map((other) => (other.id === id ? step : other))
        : [...work.steps, step],
  };
}

/** Ends a reply, with the reason if it did not finish. One that ends with
    nothing written and nothing to say about why is taken away again. */
export function endReply(work: Work, id: string, failure?: string): Work {
  const message = work.messages.find((other) => other.id === id);
  if (!message?.pending) return work;
  const { pending: _over, ...ended } = message;
  if (failure) ended.failure = failure;
  return {
    ...work,
    messages:
      ended.text || failure
        ? work.messages.map((other) => (other === message ? ended : other))
        : work.messages.filter((other) => other !== message),
  };
}

/** Whether a number is a moment a date can hold. A task's time arrives from an
    agent, and a date made from anything else throws when it is written out. */
export function isMoment(at: number): boolean {
  return Number.isFinite(at) && Math.abs(at) <= 8.64e15;
}

/**
 * Schedules the task a message proposed, as the user agreed to it, which may
 * differ from what was proposed. A proposal is taken up once: one that is
 * already scheduled, or a message that proposes nothing, changes nothing. Nor
 * does a task whose time is not a moment: there is nothing to schedule it for.
 */
export function acceptProposal(work: Work, messageId: string, task: TaskDraft): Work {
  const message = work.messages.find((other) => other.id === messageId);
  if (!message?.proposal || message.proposal.scheduled || !isMoment(task.at)) return work;
  return {
    ...work,
    messages: work.messages.map((other) =>
      other === message ? { ...message, proposal: { task, scheduled: true } } : other,
    ),
    tasks: [...work.tasks, { ...task, id: crypto.randomUUID() }],
  };
}

/* With the year: this is what the user agrees to, and two dates a year apart
   must not read alike. */
const due = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/** A task's kind, when it is due and how often, on one line. */
export function taskLine(task: TaskDraft): string {
  const when = isMoment(task.at) ? due.format(task.at) : "No valid time";
  const parts = [task.kind === "reminder" ? "Reminder" : "Task", when];
  if (task.repeats) parts.push(task.repeats);
  return parts.join(" · ");
}
