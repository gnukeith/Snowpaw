import assert from "node:assert/strict";
import { test } from "node:test";
import { firstFrameInput, frameInput, frameOutput, fromFrame, frameFailure, maxFrameHeight, maxFrameText } from "../src/components/frameMessages.ts";
const input = { type: "render", source: "graph LR; A-->B", theme: {
  background: "#ffffff", surface: "#eeeeee", text: "#111111", muted: "#777777", accent: "#112233", border: "#dddddd", font: "system-ui, sans-serif", fontSize: "14px",
} };
test("only a bounded input and resolved theme cross into the frame", () => {
  assert.ok(frameInput(input));
  for (const bad of [null, [], {}, { ...input, source: "a".repeat(maxFrameText + 1) }, { ...input, command: "vm_start" }, { ...input, theme: { ...input.theme, accent: "url(https://example.invalid)" } }, { ...input, theme: { ...input.theme, font: "a;}body{display:none}" } }]) assert.equal(frameInput(bad), false);
});
test("only the parent's first valid input is consumed, including reentrant calls", () => {
  const parent = {}, seen = [];
  const receive = firstFrameInput(parent, (value) => { seen.push(value); receive({ source: parent, data: input }); });
  receive({ source: {}, data: input }); receive({ source: parent, data: {} });
  receive({ source: parent, data: input }); receive({ source: parent, data: input });
  assert.deepEqual(seen, [input]);
});
test("height is finite and bounded and errors are a fixed plain sentence", () => {
  for (const height of [1, 200.5, maxFrameHeight]) assert.ok(frameOutput({ type: "height", height }));
  for (const height of [0, -1, NaN, Infinity, maxFrameHeight + 1, "200", null]) assert.equal(frameOutput({ type: "height", height }), false);
  assert.ok(frameOutput({ type: "error", message: frameFailure }));
  for (const bad of [{ type: "error", message: "<svg>" }, { type: "height", height: 200, command: "vm_start" }, { type: "invoke", command: "vm_start" }, null, []]) assert.equal(frameOutput(bad), false);
});
test("a sibling, parent, forged origin and detached window cannot spoof a frame", () => {
  const child = {}, data = { type: "height", height: 200 };
  assert.deepEqual(fromFrame({ source: child, data }, child), data);
  for (const source of [{}, null, undefined]) assert.equal(fromFrame({ source, origin: "null", data }, child), undefined);
  assert.equal(fromFrame({ source: null, data }, null), undefined);
});
