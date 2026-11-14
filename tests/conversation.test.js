import assert from "node:assert/strict";
import { test } from "node:test";
import {
  acceptProposal,
  endReply,
  isMoment,
  noWork,
  pendingReply,
  taskLine,
  workOf,
  writeReply,
} from "../src/data/conversation.ts";

test("an agent with no work yet has empty work", () => {
  assert.equal(workOf({}, "a"), noWork);
});

test("an agent's own work is found", () => {
  const mine = { ...noWork, diff: "x" };
  assert.equal(workOf({ a: mine }, "a"), mine);
});

test("an id that names something every object inherits finds nothing", () => {
  for (const id of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
    assert.equal(workOf({}, id), noWork);
  }
});

const proposed = { kind: "task", title: "Run the tests", at: 1000, repeats: "Every day" };
const asking = { id: "m1", from: "a", text: "Shall I?", at: 1, proposal: { task: proposed, scheduled: false } };
const plain = { id: "m2", from: "user", text: "hello", at: 2 };

test("agreeing to a proposal schedules the task and marks it taken up", () => {
  const before = { ...noWork, messages: [asking, plain] };
  const after = acceptProposal(before, "m1", proposed);
  assert.equal(after.tasks.length, 1);
  assert.deepEqual({ ...after.tasks[0], id: undefined }, { ...proposed, id: undefined });
  assert.ok(after.tasks[0].id);
  assert.deepEqual(after.messages[0].proposal, { task: proposed, scheduled: true });
  assert.equal(after.messages[1], plain);
  // What it was given is left as it was.
  assert.equal(before.tasks.length, 0);
  assert.equal(before.messages[0].proposal.scheduled, false);
});

test("what gets scheduled is what the user agreed to, not what was proposed", () => {
  const edited = { kind: "reminder", title: "Check the tests", at: 2000 };
  const after = acceptProposal({ ...noWork, messages: [asking] }, "m1", edited);
  assert.deepEqual({ ...after.tasks[0], id: undefined }, { ...edited, id: undefined });
  assert.deepEqual(after.messages[0].proposal.task, edited);
});

test("a proposal is taken up once", () => {
  const once = acceptProposal({ ...noWork, messages: [asking] }, "m1", proposed);
  assert.equal(acceptProposal(once, "m1", proposed), once);
});

test("a message that proposes nothing, or is not there, schedules nothing", () => {
  const work = { ...noWork, messages: [asking, plain] };
  assert.equal(acceptProposal(work, "m2", proposed), work);
  assert.equal(acceptProposal(work, "nope", proposed), work);
});

test("only numbers a date can hold are moments", () => {
  for (const at of [0, 1000, -1000, 8.64e15]) assert.equal(isMoment(at), true);
  for (const at of [NaN, Infinity, -Infinity, 8.64e15 + 1, undefined, "soon"]) assert.equal(isMoment(at), false);
});

test("a task without a valid time is written out, not thrown on, and cannot be scheduled", () => {
  for (const at of [NaN, Infinity, 9e15]) {
    const broken = { ...proposed, at };
    assert.match(taskLine(broken), /No valid time/);
    const work = { ...noWork, messages: [{ ...asking, proposal: { task: broken, scheduled: false } }] };
    assert.equal(acceptProposal(work, "m1", broken), work);
  }
});

test("the line a task is agreed to by carries its year", () => {
  const noon = (year) => new Date(year, 10, 14, 12).getTime();
  assert.notEqual(taskLine({ ...proposed, at: noon(2026) }), taskLine({ ...proposed, at: noon(2037) }));
  assert.match(taskLine({ ...proposed, at: noon(2037) }), /2037/);
});

/** Work with a question in it and the reply to it about to be written. */
function asked() {
  const reply = pendingReply("a");
  return { reply, work: { ...noWork, messages: [plain, reply] } };
}

test("a reply starts empty, pending and from its agent", () => {
  const { reply } = asked();
  assert.deepEqual({ ...reply, id: "", at: 0 }, { id: "", from: "a", text: "", at: 0, pending: true });
  assert.notEqual(reply.id, pendingReply("a").id);
});

test("a reply is written into its message, and its reasoning into a step", () => {
  const { reply, work } = asked();
  const first = writeReply(work, reply.id, "", "Hm");
  assert.equal(first.messages[1].text, "");
  assert.deepEqual(first.steps, [{ id: reply.id, kind: "thinking", text: "Hm", at: reply.at }]);
  const second = writeReply(first, reply.id, "Hello", "Hm, a greeting.");
  assert.equal(second.messages[1].text, "Hello");
  assert.equal(second.messages[1].pending, true);
  assert.equal(second.messages[0], plain);
  // The same step, grown: not one for every piece that arrives.
  assert.deepEqual(second.steps.map((step) => step.text), ["Hm, a greeting."]);
  // A model that does not reason leaves no step.
  assert.deepEqual(writeReply(work, reply.id, "Hello", "").steps, []);
  assert.equal(work.messages[1].text, "");
});

test("a reply that ends keeps what was written and stops pending", () => {
  const { reply, work } = asked();
  const ended = endReply(writeReply(work, reply.id, "Hello", ""), reply.id);
  assert.deepEqual(ended.messages[1], { id: reply.id, from: "a", text: "Hello", at: reply.at });
});

test("a reply that fails says why, with whatever came before it failed", () => {
  const { reply, work } = asked();
  const half = endReply(writeReply(work, reply.id, "Hel", ""), reply.id, "Cut off.");
  assert.deepEqual([half.messages[1].text, half.messages[1].failure], ["Hel", "Cut off."]);
  const none = endReply(work, reply.id, "Refused.");
  assert.deepEqual([none.messages[1].text, none.messages[1].failure, none.messages[1].pending], ["", "Refused.", undefined]);
});

test("a reply stopped before a word of it came is taken away", () => {
  const { reply, work } = asked();
  assert.deepEqual(endReply(work, reply.id).messages, [plain]);
});

test("what arrives for a reply that has ended, or is not there, changes nothing", () => {
  const { reply, work } = asked();
  const ended = endReply(writeReply(work, reply.id, "Hello", ""), reply.id);
  assert.equal(writeReply(ended, reply.id, "Hello again", "Late"), ended);
  assert.equal(endReply(ended, reply.id, "Late"), ended);
  assert.equal(writeReply(work, "nobody", "Hello", "Hm"), work);
  assert.equal(endReply(work, "nobody"), work);
  // Not a reply at all: what the person wrote is never written over.
  assert.equal(writeReply(work, plain.id, "Changed", ""), work);
});
