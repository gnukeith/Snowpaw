import assert from "node:assert/strict";
import { test } from "node:test";
import { parseButtonLayout } from "../src/data/frame.ts";

test("buttons go on the side of the colon they are written on", () => {
  assert.deepEqual(parseButtonLayout("icon:minimize,maximize,close"), {
    start: [],
    end: ["minimize", "maximize", "close"],
  });
  assert.deepEqual(parseButtonLayout("close,minimize,maximize:"), {
    start: ["close", "minimize", "maximize"],
    end: [],
  });
  assert.deepEqual(parseButtonLayout("close:minimize"), { start: ["close"], end: ["minimize"] });
});

test("things that are not window buttons are left out", () => {
  assert.deepEqual(parseButtonLayout("menu:close"), { start: [], end: ["close"] });
  assert.deepEqual(parseButtonLayout("appmenu,spacer,icon : help , close"), { start: [], end: ["close"] });
});

test("a desktop that asks for no buttons gets none", () => {
  for (const layout of ["", ":", "menu:", "icon"]) {
    assert.deepEqual(parseButtonLayout(layout), { start: [], end: [] });
  }
});

test("a button written twice is drawn once", () => {
  assert.deepEqual(parseButtonLayout("close:close,minimize,close"), {
    start: ["close"],
    end: ["minimize"],
  });
});

test("anything after a second colon is ignored", () => {
  assert.deepEqual(parseButtonLayout("minimize:close:maximize"), { start: ["minimize"], end: ["close"] });
});
