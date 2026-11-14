import assert from "node:assert/strict";
import { test } from "node:test";
import { Budget } from "../src/plugins/budget.ts";

test("claims add up to the limit and no further", () => {
  const budget = new Budget(10);
  const a = {};
  const b = {};
  assert.ok(budget.claim(a, 6));
  assert.ok(!budget.claim(b, 5));
  assert.ok(budget.claim(b, 4));
  assert.ok(!budget.claim({}, 1));
});

test("claiming again under the same name replaces, and releasing gives back", () => {
  const budget = new Budget(10);
  const a = {};
  assert.ok(budget.claim(a, 8));
  // Drawn again, as a theme change or React's development replay would.
  assert.ok(budget.claim(a, 8));
  assert.ok(budget.claim(a, 3));
  assert.ok(budget.claim({}, 7));
  budget.release(a);
  assert.ok(budget.claim({}, 3));
  // Releasing what was never claimed changes nothing.
  budget.release({});
  assert.ok(!budget.claim({}, 1));
});

test("work done is counted whether it was kept or not, and stops at twice the limit", () => {
  const budget = new Budget(10);
  assert.ok(budget.mayWork());
  budget.worked(15);
  assert.ok(budget.mayWork());
  budget.worked(5);
  assert.ok(!budget.mayWork());
  // Releasing a claim does not give back work already done.
  const a = {};
  budget.claim(a, 5);
  budget.release(a);
  assert.ok(!budget.mayWork());
});
