/* Made-up agents and work, loaded from Settings in development builds so the
   app can be looked at with something in it. Nothing here is real, and a
   release build does not include this file. */
import type { Agent } from "../data/agents";
import {
  noWork,
  type AllWork,
  type Message,
  type Step,
  type Task,
} from "../data/conversation";

const prefix = "sample-";

export function isSample(agent: Agent): boolean {
  return agent.id.startsWith(prefix);
}

const diff = `diff --git a/src/dates/parse.ts b/src/dates/parse.ts
index 3c1f9aa..8d27b40 100644
--- a/src/dates/parse.ts
+++ b/src/dates/parse.ts
@@ -12,6 +12,7 @@ import { normalize } from "./normalize";
 export function parseDate(text: string): Date | null {
   const ms = Date.parse(normalize(text));
-  if (!(ms > 0)) return null;
+  // Dates before 1970 are negative numbers, and they are real dates.
+  if (Number.isNaN(ms)) return null;
   return new Date(ms);
 }

diff --git a/src/dates/parse.test.ts b/src/dates/parse.test.ts
index 77e0c12..b9a4f03 100644
--- a/src/dates/parse.test.ts
+++ b/src/dates/parse.test.ts
@@ -31,2 +31,6 @@ test("parses dates before 1970", () => {
   expect(parseDate("1969-07-20")).toEqual(new Date("1969-07-20T00:00:00.000Z"));
 });
+
+test("still rejects text that is not a date", () => {
+  expect(parseDate("the day after tomorrow, give or take")).toBeNull();
+});
diff --git a/docs/dates.md b/docs/dates.md
new file mode 100644
--- /dev/null
+++ b/docs/dates.md
@@ -0,0 +1,3 @@
+# Dates
+
+Any date JavaScript can represent is accepted, including dates before 1970.
`;

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

  /** Due at `hourOfDay` o'clock, `days` days from today. */
  const task = (days: number, hourOfDay: number, kind: Task["kind"], title: string, repeats?: string): Task => {
    const due = new Date();
    due.setDate(due.getDate() + days);
    due.setHours(hourOfDay, 0, 0, 0);
    return { id: `${prefix}task-${++count}`, kind, title, at: due.getTime(), repeats };
  };

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
        {
          ...say(
            12,
            engineer,
            "This only stayed broken because nothing ran the tests for a week. I could run them every morning and tell you what failed.",
          ),
          proposal: {
            task: task(1, 7, "task", "Run the full test suite and tell you what failed", "Every day"),
            scheduled: false,
          },
        },
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
      diff,
      tasks: [
        task(3, 9, "reminder", "Read Thursday's release notes before they go out"),
        task(5, 18, "task", "Update dependencies and open a change for you to read", "Every week"),
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
    [finance.id]: {
      ...noWork,
      messages: [
        say(40, "user", "If I put away $400 a month at 5% a year, what do I have after 20 years? Show me the formula too."),
        say(
          41,
          finance,
          [
            "About **$164,413**, of which $96,000 is what you paid in.",
            "",
            "With a monthly rate $r = 0.05 / 12$ and $n = 240$ payments of $P = 400$:",
            "",
            "$$FV = P \\cdot \\frac{(1 + r)^n - 1}{r}$$",
            "",
            "| After | You paid in | You have |",
            "| --- | --- | --- |",
            "| 5 years | $24,000 | $27,202 |",
            "| 10 years | $48,000 | $62,113 |",
            "| 20 years | $96,000 | $164,413 |",
            "",
            "The same sum in code, if you want to change the numbers:",
            "",
            "```python",
            "r, n, p = 0.05 / 12, 240, 400",
            "print(p * ((1 + r) ** n - 1) / r)",
            "```",
            "",
            "How the balance grows, against what you paid in:",
            "",
            "```plot",
            "title: $400 a month at 5% a year",
            "xlabel: years",
            "ylabel: dollars",
            "x: 0 .. 20",
            "balance(x) = 400 * ((1 + 0.05/12)^(12x) - 1) / (0.05/12)",
            "paid_in(x) = 4800x",
            "points After 5, 10 and 20 years: (5, 27202), (10, 62113), (20, 164413)",
            "```",
            "",
            "Where each payment goes:",
            "",
            "```mermaid",
            "flowchart LR",
            "  payment[Monthly payment] --> savings[Savings]",
            "  savings --> interest[Interest]",
            "  interest --> savings",
            "  savings --> goal[Twenty-year balance]",
            "```",
            "",
            "1. Paying in at the start of each month adds about $685.",
            "2. A formula I cannot draw stays as written: $\\frac{1}{$",
          ].join("\n"),
        ),
      ],
    },
    [health.id]: {
      ...noWork,
      messages: [say(60, health, "You asked me to remind you to stretch. It has been two hours.")],
      tasks: [task(0, 23, "reminder", "Stretch", "Every 2 hours")],
    },
  };

  return { agents: [engineer, marketing, inbox, health, finance], work };
}
