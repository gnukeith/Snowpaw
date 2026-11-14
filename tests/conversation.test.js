import assert from "node:assert/strict";
import { test } from "node:test";
import { noWork, workOf } from "../src/data/conversation.ts";

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
