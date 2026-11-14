import assert from "node:assert/strict";
import { test } from "node:test";
import { inTurn } from "../src/data/keyring.ts";

/** A call that finishes when told to, and records when it started and ended. */
function held(log, name, fails = false) {
  let finish;
  const done = new Promise((resolve) => (finish = resolve));
  const call = async () => {
    log.push(`${name} starts`);
    await done;
    log.push(`${name} ends`);
    if (fails) throw new Error(name);
    return name;
  };
  return { call, finish };
}

test("calls about one key run one after another, in the order they were made", async () => {
  const log = [];
  const forget = held(log, "forget");
  const ask = held(log, "ask");
  const first = inTurn("a", forget.call);
  const second = inTurn("a", ask.call);
  await Promise.resolve();
  assert.deepEqual(log, ["forget starts"]);
  ask.finish();
  forget.finish();
  assert.equal(await first, "forget");
  assert.equal(await second, "ask");
  assert.deepEqual(log, ["forget starts", "forget ends", "ask starts", "ask ends"]);
});

test("a call that fails does not stop the ones after it, and keeps its own failure", async () => {
  const log = [];
  const save = held(log, "save", true);
  const ask = held(log, "ask");
  const first = inTurn("b", save.call);
  const second = inTurn("b", ask.call);
  save.finish();
  ask.finish();
  await assert.rejects(first, /save/);
  assert.equal(await second, "ask");
});

test("calls about different keys do not wait for each other", async () => {
  const log = [];
  const slow = held(log, "slow");
  const quick = held(log, "quick");
  inTurn("c", slow.call);
  const other = inTurn("d", quick.call);
  await Promise.resolve();
  assert.deepEqual(log, ["slow starts", "quick starts"]);
  quick.finish();
  assert.equal(await other, "quick");
  slow.finish();
});

test("a request whose view has gone by its turn is never sent", async () => {
  const { testSearch, listModels } = await import("../src/data/keyring.ts");
  // Were it sent, it would fail differently: there is no app to send it to.
  await assert.rejects(testSearch(() => false), (failure) => failure.kind === "dropped");
  await assert.rejects(listModels("x", "https://example.com/v1", { alive: () => false }), (failure) => failure.kind === "dropped");
});
