import assert from "node:assert/strict";
import { test } from "node:test";
import { connectionFor, describeReplyFailure, turnsOf, whyNoConnection } from "../src/data/chat.ts";

const agent = { id: "a", name: "Engineer", hue: 0, pinned: false };
const local = { id: "c1", preset: "custom", name: "Local", address: "http://localhost:8080/v1", model: "qwen" };
const cloud = { id: "c2", preset: "openai", name: "OpenAI", address: "https://api.openai.com/v1", model: "gpt" };
const unfinished = { ...cloud, id: "c3", model: "" };

test("an agent is answered by the connection chosen for it", () => {
  assert.equal(connectionFor({ ...agent, connection: "c2" }, [local, cloud]), cloud);
});

test("with no choice made, the only connection there is answers", () => {
  assert.equal(connectionFor(agent, [local]), local);
  // One without a model cannot answer, and does not count.
  assert.equal(connectionFor(agent, [unfinished, local]), local);
});

test("which server reads a conversation is never a guess", () => {
  assert.equal(connectionFor(agent, []), undefined);
  assert.equal(connectionFor(agent, [unfinished]), undefined);
  assert.equal(connectionFor(agent, [local, cloud]), undefined);
  // The one chosen has gone: the one that is left was not chosen.
  assert.equal(connectionFor({ ...agent, connection: "c1" }, [cloud]), undefined);
  assert.equal(connectionFor({ ...agent, connection: "c3" }, [unfinished, local]), undefined);
});

test("each way of having nothing to answer with says what to do", () => {
  assert.match(whyNoConnection(agent, [unfinished]), /in Settings/);
  assert.match(whyNoConnection({ ...agent, connection: "c1" }, [cloud]), /no longer connected/);
  assert.match(whyNoConnection(agent, [local, cloud]), /More than one/);
});

const say = (from, text, rest = {}) => ({ id: crypto.randomUUID(), from, text, at: 0, ...rest });

test("a conversation is sent as the turns of the person and the agent", () => {
  assert.deepEqual(turnsOf([say("user", "Hi"), say("a", "Hello"), say("user", "Bye")], "a"), [
    { role: "user", content: "Hi" },
    { role: "assistant", content: "Hello" },
    { role: "user", content: "Bye" },
  ]);
});

test("messages in a row from one side are sent as one turn", () => {
  assert.deepEqual(turnsOf([say("user", "One"), say("user", "Two"), say("a", "A"), say("a", "B")], "a"), [
    { role: "user", content: "One\n\nTwo" },
    { role: "assistant", content: "A\n\nB" },
  ]);
});

test("what agents wrote to each other, and replies with nothing in them, are not sent", () => {
  const messages = [
    say("user", "Ask Marketing"),
    say("a", "Does it need a line?", { to: "b" }),
    say("b", "Yes.", { to: "a" }),
    say("b", "Hello from another agent"),
    say("a", "", { failure: "It did not work." }),
    say("a", "", { pending: true }),
    say("user", "Well?"),
  ];
  assert.deepEqual(turnsOf(messages, "a"), [{ role: "user", content: "Ask Marketing\n\nWell?" }]);
  assert.deepEqual(turnsOf([], "a"), []);
});

test("what is sent is made anew, and the messages are left as they were", () => {
  const messages = [say("user", "One"), say("user", "Two")];
  turnsOf(messages, "a");
  assert.equal(messages[0].text, "One");
});

test("every way a reply can fail has words of its own or the general ones", () => {
  const kinds = ["refused", "request", "missing", "timeout", "interrupted", "long", "unreachable", "server"];
  const words = kinds.map((kind) => describeReplyFailure({ kind }));
  assert.equal(new Set(words).size, kinds.length);
  for (const unknown of [undefined, null, "text", {}, { kind: "new" }]) {
    assert.equal(describeReplyFailure(unknown), "It did not work, and Snowpaw could not tell why.");
  }
});
