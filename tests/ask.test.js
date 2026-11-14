import assert from "node:assert/strict";
import { beforeEach, mock, test } from "node:test";

/* Stands in for what Tauri puts in the page: the callbacks channels
   register, and calls to the Rust side, which the test answers by hand. */
const callbacks = new Map();
let calls = [];
let frames = [];
globalThis.window = {
  __TAURI_INTERNALS__: {
    transformCallback(callback) {
      const id = callbacks.size + 1 + Math.floor(Math.random() * 1e9);
      callbacks.set(id, callback);
      return id;
    },
    unregisterCallback: (id) => callbacks.delete(id),
    invoke: (command, args) => new Promise((resolve, reject) => calls.push({ command, args, resolve, reject })),
  },
};
globalThis.document = { hidden: false };
globalThis.requestAnimationFrame = (callback) => frames.push(callback);
globalThis.cancelAnimationFrame = () => {};

const { ask } = await import("../src/data/chat.ts");

const connection = { id: "c1", preset: "openai", name: "Cloud", address: "https://example.com/v1", model: "m" };
const turns = [{ role: "user", content: "Hi" }];

/** Lets promises that are ready run. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

/** A reply being asked for, with the test's hands on both ends of it. */
function asking() {
  const shown = [];
  const reply = ask(connection, turns, (text, thinking) => shown.push([text, thinking]));
  const outcome = reply.done.then(
    () => "finished",
    (failure) => failure,
  );
  const send = calls.find((call) => call.command === "chat_send");
  const channel = send.args.pieces.id;
  return {
    reply,
    shown,
    outcome,
    send,
    channel,
    /** Delivers the piece the Rust side sent as its `index`th. */
    piece: (index, message) => callbacks.get(channel)?.({ index, message }),
    /** Tauri's own word that `count` pieces were sent and no more will be. */
    close: (count) => callbacks.get(channel)?.({ index: count, end: true }),
  };
}

beforeEach(() => {
  callbacks.clear();
  calls = [];
  frames = [];
  document.hidden = false;
  mock.timers.reset();
  mock.timers.enable({ apis: ["setTimeout"] });
});

test("a reply is asked for with its connection, and arrives in pieces", async () => {
  const { shown, outcome, send, piece, close, channel } = asking();
  assert.deepEqual(
    { ...send.args, request: "", pieces: null },
    { request: "", id: "c1", address: "https://example.com/v1", model: "m", turns, needsKey: true, pieces: null },
  );
  piece(0, { kind: "thinking", text: "Hm" });
  piece(1, { kind: "text", text: "Hel" });
  piece(2, { kind: "text", text: "lo" });
  // No frame was drawn, as in a window nobody is looking at.
  assert.deepEqual(shown, []);
  piece(3, { kind: "end" });
  close(4);
  send.resolve();
  assert.equal(await outcome, "finished");
  assert.deepEqual(shown, [["Hello", "Hm"]]);
  // Tauri let go of the channel itself, and nothing is left waiting.
  assert.equal(callbacks.has(channel), false);
  mock.timers.tick(60_000);
  assert.deepEqual(shown, [["Hello", "Hm"]]);
});

test("progress is shown once for each frame drawn", () => {
  const { shown, piece } = asking();
  piece(0, { kind: "text", text: "a" });
  piece(1, { kind: "text", text: "b" });
  assert.equal(frames.length, 1);
  frames.shift()();
  piece(2, { kind: "text", text: "c" });
  frames.shift()();
  assert.deepEqual(shown, [["ab", ""], ["abc", ""]]);
});

test("pieces that arrive out of order are put back in it", async () => {
  const { outcome, shown, piece } = asking();
  piece(1, { kind: "text", text: "b" });
  piece(2, { kind: "end" });
  piece(0, { kind: "text", text: "a" });
  assert.equal(await outcome, "finished");
  assert.deepEqual(shown.at(-1), ["ab", ""]);
});

test("a failure is the last piece, after what was written before it", async () => {
  const { outcome, shown, piece } = asking();
  piece(0, { kind: "text", text: "Hel" });
  piece(1, { kind: "end", failure: { kind: "interrupted" } });
  assert.deepEqual(await outcome, { kind: "interrupted" });
  assert.deepEqual(shown.at(-1), ["Hel", ""]);
});

test("pieces still arriving after the call was answered are waited for", async () => {
  const { outcome, shown, send, piece } = asking();
  send.resolve();
  await settle();
  for (const [index, text] of ["1", "2", "3", "4"].entries()) {
    mock.timers.tick(4_000);
    piece(index, { kind: "text", text });
  }
  mock.timers.tick(4_000);
  piece(4, { kind: "end" });
  assert.equal(await outcome, "finished");
  assert.deepEqual(shown.at(-1), ["1234", ""]);
});

test("a reply with a piece missing is given up on, and its channel let go", async () => {
  const { outcome, shown, send, piece, close, channel } = asking();
  // The first piece never arrives, so the rest wait behind it.
  piece(1, { kind: "text", text: "never shown" });
  piece(2, { kind: "end" });
  close(3);
  send.resolve();
  await settle();
  mock.timers.tick(4_999);
  assert.equal(callbacks.has(channel), true);
  mock.timers.tick(1);
  assert.deepEqual(await outcome, { kind: "interrupted" });
  assert.deepEqual(shown, [["", ""]]);
  assert.equal(callbacks.has(channel), false);
});

test("a hidden page is not given up on until it is seen again", async () => {
  const { outcome, send, piece } = asking();
  let ended = false;
  outcome.then(() => (ended = true));
  document.hidden = true;
  send.resolve();
  await settle();
  mock.timers.tick(60_000);
  await settle();
  assert.equal(ended, false);
  piece(0, { kind: "end" });
  assert.equal(await outcome, "finished");
});

test("a call that fails ends the reply and lets its channel go", async () => {
  const { outcome, send, channel } = asking();
  send.reject({ kind: "interrupted" });
  assert.deepEqual(await outcome, { kind: "interrupted" });
  assert.equal(callbacks.has(channel), false);
  const other = asking();
  calls.findLast((call) => call.command === "chat_send").reject(undefined);
  assert.deepEqual(await other.outcome, {});
});

test("stopping ends the reply at once, with what had arrived, and tells the Rust side", async () => {
  const { reply, outcome, shown, send, piece } = asking();
  piece(0, { kind: "text", text: "Hel" });
  reply.stop();
  assert.equal(await outcome, "finished");
  assert.deepEqual(shown.at(-1), ["Hel", ""]);
  const stop = calls.find((call) => call.command === "chat_stop");
  assert.equal(stop.args.request, send.args.request);
  // What arrives afterwards changes nothing, and a second stop does nothing.
  const before = shown.length;
  piece(1, { kind: "text", text: "lo" });
  piece(2, { kind: "end", failure: { kind: "stopped" } });
  reply.stop();
  assert.equal(shown.length, before);
  assert.equal(calls.filter((call) => call.command === "chat_stop").length, 1);
});
