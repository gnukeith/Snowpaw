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

/**
 * Schedules the task a message proposed, as the user agreed to it, which may
 * differ from what was proposed. A proposal is taken up once: one that is
 * already scheduled, or a message that proposes nothing, changes nothing.
 */
export function acceptProposal(work: Work, messageId: string, task: TaskDraft): Work {
  const message = work.messages.find((other) => other.id === messageId);
  if (!message?.proposal || message.proposal.scheduled) return work;
  return {
    ...work,
    messages: work.messages.map((other) =>
      other === message ? { ...message, proposal: { task, scheduled: true } } : other,
    ),
    tasks: [...work.tasks, { ...task, id: crypto.randomUUID() }],
  };
}

const due = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/** A task's kind, when it is due and how often, on one line. */
export function taskLine(task: TaskDraft): string {
  const parts = [task.kind === "reminder" ? "Reminder" : "Task", due.format(task.at)];
  if (task.repeats) parts.push(task.repeats);
  return parts.join(" · ");
}
