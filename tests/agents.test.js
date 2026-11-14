import assert from "node:assert/strict";
import { test } from "node:test";
import { canPin, cleanName, initials, maxNameLength, parseAgents } from "../src/data/agents.ts";

const agent = (id, extra = {}) => ({ id, name: `Agent ${id}`, hue: 10, pinned: false, ...extra });

test("a well-formed list comes back unchanged", () => {
  const saved = [agent("a", { pinned: true, picture: "data:image/webp;base64,AAAA" }), agent("b")];
  assert.deepEqual(parseAgents(saved), [
    { ...saved[0] },
    { ...saved[1], picture: undefined },
  ]);
});

test("anything that is not a list of agents is dropped", () => {
  assert.deepEqual(parseAgents(null), []);
  assert.deepEqual(parseAgents({ id: "a", name: "A" }), []);
  assert.deepEqual(
    parseAgents([null, "text", 3, {}, { id: "", name: "A" }, { id: 7, name: "A" }, { id: "a", name: "  " }]),
    [],
  );
});

test("a repeated id keeps only the first agent", () => {
  const agents = parseAgents([agent("a", { name: "First" }), agent("a", { name: "Second" })]);
  assert.deepEqual(agents.map((entry) => entry.name), ["First"]);
});

test("pins beyond the limit are released", () => {
  const saved = ["a", "b", "c", "d"].map((id) => agent(id, { pinned: true }));
  assert.deepEqual(parseAgents(saved).map((entry) => entry.pinned), [true, true, true, false]);
});

test("a pin has to be exactly true", () => {
  assert.equal(parseAgents([agent("a", { pinned: "yes" })])[0].pinned, false);
});

test("a picture that is not an image data URL is dropped", () => {
  const pictures = ["https://example.com/a.png", "data:text/html,<script>", 5];
  for (const picture of pictures) {
    assert.equal(parseAgents([agent("a", { picture })])[0].picture, undefined);
  }
});

test("a hue that is not a number falls back to zero", () => {
  assert.equal(parseAgents([agent("a", { hue: "red" })])[0].hue, 0);
  assert.equal(parseAgents([agent("a", { hue: Infinity })])[0].hue, 0);
});

test("names are trimmed, collapsed and capped", () => {
  assert.equal(cleanName("  Launch \n  Bot "), "Launch Bot");
  assert.equal(cleanName("x".repeat(100)).length, maxNameLength);
  assert.equal(cleanName(undefined), "");
});

test("a fourth pin is refused", () => {
  const three = ["a", "b", "c"].map((id) => agent(id, { pinned: true }));
  assert.equal(canPin(three.slice(0, 2)), true);
  assert.equal(canPin([...three, agent("d")]), false);
});

test("initials take the first letter of up to two words", () => {
  assert.equal(initials("armand segall"), "AS");
  assert.equal(initials("fedora"), "F");
  assert.equal(initials("a b c"), "AB");
  assert.equal(initials("  "), "");
});

test("the connection chosen for an agent is kept, and anything else in its place is dropped", () => {
  assert.equal(parseAgents([agent("a", { connection: "c1" })])[0].connection, "c1");
  for (const connection of ["", 5, null, {}]) {
    assert.equal(Object.hasOwn(parseAgents([agent("a", { connection })])[0], "connection"), false);
  }
});
