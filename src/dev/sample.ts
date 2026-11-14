/* Made-up agents and work, loaded from Settings in development builds so the
   app can be looked at with something in it. Nothing here is real, and a
   release build does not include this file. */
import type { Agent } from "../data/agents";
import type { AllWork, Message } from "../data/conversation";

const prefix = "sample-";

export function isSample(agent: Agent): boolean {
  return agent.id.startsWith(prefix);
}

const minute = 60 * 1000;
const hour = 60 * minute;

export function sample(): { agents: Agent[]; work: AllWork } {
  const agent = (id: string, name: string, hue: number, pinned = false): Agent => ({
    id: prefix + id,
    name,
    hue,
    pinned,
  });
  const engineer = agent("engineer", "Engineer", 165, true);
  const marketing = agent("marketing", "Marketing", 300, true);
  const inbox = agent("inbox", "Inbox", 250, true);
  const health = agent("health", "Health", 25);
  const finance = agent("finance", "Finance", 80);

  const start = Date.now() - 3 * hour;
  let count = 0;
  /** A message `minutes` after the start. Between agents when `to` is given. */
  const say = (minutes: number, from: Agent | "user", text: string, to?: Agent): Message => ({
    id: `${prefix}message-${++count}`,
    from: from === "user" ? "user" : from.id,
    to: to?.id,
    text,
    at: start + minutes * minute,
  });

  const work: AllWork = {
    [engineer.id]: {
      messages: [
        say(
          0,
          "user",
          "The date parser test has been failing since yesterday. Can you fix it, and ask Marketing whether the changelog needs a line?",
        ),
        say(1, engineer, "On it. I'm running the tests on the computer now."),
        say(
          4,
          engineer,
          "I'm fixing a bug where exports rejected any date before 1970. People could see it. Does it deserve a changelog line?",
          marketing,
        ),
        say(
          5,
          marketing,
          "Yes. Send me one plain sentence once it's fixed and I'll put it in Thursday's notes.",
          engineer,
        ),
        say(9, engineer, "Exports no longer reject dates before 1970.", marketing),
        say(10, marketing, "Added, thanks.", engineer),
        say(
          11,
          engineer,
          "Fixed. The parser treated every date before 1970 as an error. All 42 tests pass now, and Marketing has added a line to Thursday's release notes.",
        ),
        say(95, "user", "nice, thank you"),
      ],
    },
    [marketing.id]: {
      messages: [
        say(
          12,
          marketing,
          "Engineer asked for a changelog line about the export fix. I added it to Thursday's release notes.",
        ),
      ],
    },
    [inbox.id]: {
      messages: [
        say(30, inbox, "I archived 3 newsletters. Two emails need you: the lease renewal and a note from Dana."),
      ],
    },
    [health.id]: {
      messages: [say(60, health, "You asked me to remind you to stretch. It has been two hours.")],
    },
  };

  return { agents: [engineer, marketing, inbox, health, finance], work };
}
