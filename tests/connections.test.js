import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cleanAddress,
  custom,
  describeFailure,
  hostLabel,
  newConnection,
  parseConnections,
  presetOf,
  presets,
  sendsKeyInTheClear,
} from "../src/data/connections.ts";

/* Ids as crypto.randomUUID makes them, which is the only kind stored. */
const ids = { a: "0b5c8f7e-2f7a-4c1e-9d1a-3f6c1a2b4c5d", b: "6a1d9e2c-7b3f-4e8a-a2c4-5d6e7f8a9b0c", c: "c3d4e5f6-a7b8-4c9d-8e0f-1a2b3c4d5e6f" };
const connection = (id, extra = {}) => ({
  id: ids[id] ?? id,
  preset: "openai",
  name: `Provider ${id}`,
  address: "https://api.example.com/v1",
  model: "model-1",
  ...extra,
});

test("an address keeps its scheme, host, port and path, and loses the rest", () => {
  assert.equal(cleanAddress("https://api.example.com/v1"), "https://api.example.com/v1");
  assert.equal(cleanAddress("  https://API.Example.com:8443/v1///  "), "https://api.example.com:8443/v1");
  assert.equal(cleanAddress("https://api.example.com/v1?key=abc#top"), "https://api.example.com/v1");
  assert.equal(cleanAddress("https://api.example.com"), "https://api.example.com");
});

test("an address typed without a scheme gets one that fits where it points", () => {
  assert.equal(cleanAddress("api.example.com/v1"), "https://api.example.com/v1");
  assert.equal(cleanAddress("localhost:11434/v1"), "http://localhost:11434/v1");
  assert.equal(cleanAddress("127.0.0.1:8080"), "http://127.0.0.1:8080");
  assert.equal(cleanAddress("[::1]:8080/v1"), "http://[::1]:8080/v1");
  assert.equal(cleanAddress("192.168.1.20:8000/v1"), "http://192.168.1.20:8000/v1");
  assert.equal(cleanAddress("10.0.0.5:8000"), "http://10.0.0.5:8000");
  assert.equal(cleanAddress("172.16.4.1:8000"), "http://172.16.4.1:8000");
  assert.equal(cleanAddress("172.32.4.1:8000"), "https://172.32.4.1:8000");
  assert.equal(cleanAddress("gpu-box:8000/v1"), "http://gpu-box:8000/v1");
  assert.equal(cleanAddress("inference.local/v1"), "http://inference.local/v1");
  assert.equal(cleanAddress("[::ffff:127.0.0.1]:8000/v1"), "http://[::ffff:7f00:1]:8000/v1");
  assert.equal(cleanAddress("[fe80::1]:8000"), "http://[fe80::1]:8000");
  assert.equal(cleanAddress("[fd12::1]:8000"), "http://[fd12::1]:8000");
  assert.equal(cleanAddress("[fec0::1]:8000"), "https://[fec0::1]:8000");
  assert.equal(cleanAddress("[2001:db8::1]:8000"), "https://[2001:db8::1]:8000");
});

test("a mistyped scheme or a control character is refused, not guessed at", () => {
  assert.equal(cleanAddress("https:/api.example.com/v1"), "");
  assert.equal(cleanAddress("https:api.example.com"), "");
  assert.equal(cleanAddress("http:/localhost:8000"), "");
  assert.equal(cleanAddress("https://api.exa\nmple.com/v1"), "");
  assert.equal(cleanAddress("https://api.example.com/v1\t"), "https://api.example.com/v1");
  assert.equal(cleanAddress("api.example.com\u0000/v1"), "");
  // A host and its port still need no scheme.
  assert.equal(cleanAddress("gpu-box:8000/v1"), "http://gpu-box:8000/v1");
});

test("what is not a web address is not an address", () => {
  for (const text of ["", "   ", "ftp://example.com", "file:///etc/passwd", "javascript:alert(1)", "http://", "https://exa mple.com", null, 7, {}]) {
    assert.equal(cleanAddress(text), "", String(text));
  }
});

test("an address with a name and password in it is turned away", () => {
  assert.equal(cleanAddress("https://user:secret@api.example.com/v1"), "");
  assert.equal(cleanAddress("https://sk-secret@api.example.com/v1"), "");
});

test("a key is in the clear over plain http, except to this computer", () => {
  assert.equal(sendsKeyInTheClear("http://192.168.1.20:8000/v1"), true);
  assert.equal(sendsKeyInTheClear("http://gpu-box:8000"), true);
  assert.equal(sendsKeyInTheClear("http://localhost:11434/v1"), false);
  assert.equal(sendsKeyInTheClear("http://127.0.0.1:1234/v1"), false);
  assert.equal(sendsKeyInTheClear("http://[::1]:8080"), false);
  assert.equal(sendsKeyInTheClear("http://localhost.:8080/v1"), false);
  assert.equal(sendsKeyInTheClear("http://[::ffff:127.0.0.1]:8000/v1"), false);
  assert.equal(sendsKeyInTheClear("http://[::ffff:10.0.0.1]:8000/v1"), true);
  assert.equal(sendsKeyInTheClear("https://api.example.com/v1"), false);
  assert.equal(sendsKeyInTheClear("not an address"), false);
});

test("a host label is the host and its port", () => {
  assert.equal(hostLabel("https://api.example.com/v1"), "api.example.com");
  assert.equal(hostLabel("http://localhost:11434/v1"), "localhost:11434");
  assert.equal(hostLabel("nonsense"), "nonsense");
});

test("every preset has a usable address, apart from the one you type yourself", () => {
  const ids = new Set();
  for (const preset of presets) {
    assert.ok(!ids.has(preset.id), preset.id);
    ids.add(preset.id);
    if (preset.id === custom) assert.equal(preset.address, "");
    else assert.equal(cleanAddress(preset.address), preset.address, preset.id);
    // What the Rust side accepts as a path to ask after the list.
    if (preset.proof !== undefined) assert.match(preset.proof, /^\/[A-Za-z0-9/_-]*$/, preset.id);
  }
  assert.equal(presetOf("no such preset").id, custom);
});

test("a new connection starts from its preset", () => {
  assert.equal(newConnection(presetOf("openai"), ids.a).id, ids.a);
  const made = newConnection(presetOf("openai"));
  assert.equal(made.name, "OpenAI");
  assert.equal(made.address, presetOf("openai").address);
  assert.equal(made.model, "");
  assert.ok(made.id);
  assert.equal(newConnection(presetOf(custom)).name, "");
});

test("a well-formed list comes back unchanged", () => {
  const saved = [connection("a"), connection("b", { preset: custom, model: "" })];
  assert.deepEqual(parseConnections(saved), saved);
});

test("anything that is not a list of connections is dropped", () => {
  assert.deepEqual(parseConnections(null), []);
  assert.deepEqual(parseConnections(connection("a")), []);
  assert.deepEqual(
    parseConnections([
      null,
      "text",
      {},
      connection(""),
      connection(7),
      connection("a", { name: "  " }),
      connection("search"),
      connection("new"),
      connection(ids.a.toUpperCase()),
      connection("b", { address: "ftp://example.com" }),
      connection("c", { address: "https://user:pw@example.com" }),
    ]),
    [],
  );
});

test("a repeated id keeps the first, and loose fields are tidied", () => {
  const parsed = parseConnections([
    connection("a", { name: "  My   server ", address: "localhost:8000/v1/", preset: "gone", model: 9 }),
    connection("a", { name: "Second" }),
  ]);
  assert.deepEqual(parsed, [
    { id: ids.a, preset: custom, name: "My server", address: "http://localhost:8000/v1", model: "" },
  ]);
});

test("a failure is said in words, whatever arrives", () => {
  assert.match(describeFailure({ kind: "refused" }), /turned the key down/);
  assert.match(describeFailure({ kind: "refused" }, false), /wants a key/);
  assert.match(describeFailure({ kind: "server", status: 503 }), /\(503\)/);
  assert.match(describeFailure({ kind: "missing" }), /often \/v1/);
  assert.match(describeFailure({ kind: "missing" }, false), /may want a key/);
  assert.match(describeFailure({ kind: "keyring" }), /keyring/);
  const unknown = describeFailure({ kind: "something new" });
  for (const odd of [null, undefined, "text", 5, {}, new Error("x")]) {
    assert.equal(describeFailure(odd), unknown);
  }
});
