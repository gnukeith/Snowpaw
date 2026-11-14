import assert from "node:assert/strict";
import { test } from "node:test";
import { acceptProposal, isMoment, noWork, taskLine, workOf } from "../src/data/conversation.ts";

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
