/* Made-up agents and work, loaded from Settings in development builds so the
   app can be looked at with something in it. Nothing here is real, and a
   release build does not include this file. */
import type { Agent } from "../data/agents";
import { noWork, type AllWork, type Message, type Step } from "../data/conversation";

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

  const step = (minutes: number, kind: Step["kind"], text: string, source?: string): Step => ({
    id: `${prefix}step-${++count}`,
    kind,
    source,
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
      steps: [
        step(
          1,
          "thinking",
          "The failing test is parses_dates_before_1970. I should see the failure myself before changing anything, so I'll run the tests first and then read the parser.",
        ),
        step(
          2,
          "output",
          [
            " FAIL  src/dates/parse.test.ts > parses dates before 1970",
            "AssertionError: expected null to deeply equal 1969-07-20T00:00:00.000Z",
            "",
            " Test Files  1 failed | 6 passed (7)",
            "      Tests  1 failed | 41 passed (42)",
          ].join("\n"),
          "pnpm test",
        ),
        step(
          3,
          "thinking",
          "The parser returns null when the timestamp is not above zero. That guard was meant to catch a date that could not be read, which gives NaN, but it also throws away every real date before 1970, because those are negative. Checking for NaN by name keeps what the guard was for and nothing else. Exports use this parser, so people will have seen the bug: I'll ask Marketing about the changelog.",
        ),
        step(
          8,
          "output",
          [" Test Files  7 passed (7)", "      Tests  42 passed (42)", "   Duration  1.31s"].join("\n"),
          "pnpm test",
        ),
      ],
    },
    [marketing.id]: {
      ...noWork,
      messages: [
        say(
          12,
          marketing,
          "Engineer asked for a changelog line about the export fix. I added it to Thursday's release notes.",
        ),
      ],
    },
    [inbox.id]: {
      ...noWork,
      messages: [
        say(30, inbox, "I archived 3 newsletters. Two emails need you: the lease renewal and a note from Dana."),
      ],
    },
    [health.id]: {
      ...noWork,
      messages: [say(60, health, "You asked me to remind you to stretch. It has been two hours.")],
    },
  };

  return { agents: [engineer, marketing, inbox, health, finance], work };
}
