import { invoke } from "@tauri-apps/api/core";

/* What the page may ask the Rust side about keys and the servers they are
   for. There is no way to read a key back: the page can save one, ask whether
   one is saved, forget it, and have a request made with it. A key is saved
   for one address and is only ever sent there. Each call fails with a
   `Failure` from connections.ts. */

/* Every call about one connection's key waits for the calls before it about
   the same key to finish. A view that asks, saves or forgets can be closed
   and opened again while its call is still out; queued here, outside any
   view, a later question cannot be answered before an earlier save or forget
   has landed, and a forget cannot overtake the save that followed it. */
const turns = new Map<string, Promise<unknown>>();

/** Runs `call` once every earlier call about the key `id` has finished.
    Not to be called from inside a `call` for the same id: that call would
    wait for itself. */
export function inTurn<T>(id: string, call: () => Promise<T>): Promise<T> {
  const before = turns.get(id) ?? Promise.resolve();
  // An earlier call that failed has still finished.
  const mine = before.then(call, call);
  const done = mine.then(
    () => {},
    () => {},
  );
  turns.set(id, done);
  // Forget the queue once nothing is waiting in it.
  done.then(() => turns.get(id) === done && turns.delete(id));
  return mine;
}

/** Saves the key for a connection, replacing any it had. */
export function saveKey(id: string, address: string, key: string): Promise<void> {
  return inTurn(id, () => invoke("key_save", { id, address, key }));
}

/** Whether a key is saved for this connection at this address. */
export function hasKey(id: string, address: string): Promise<boolean> {
  return inTurn(id, () => invoke("key_exists", { id, address }));
}

export function forgetKey(id: string): Promise<void> {
  return inTurn(id, () => invoke("key_forget", { id }));
}

/** What a request that was waiting its turn fails with when the view that
    asked for it has gone by the time its turn comes: it is never sent. */
const dropped = { kind: "dropped" };

/** A request to a server, sent when its turn comes only if `alive` still
    says the view that asked for it is there. Saves and forgets are never
    dropped this way: they must land whoever asked. */
function sendInTurn<T>(id: string, alive: (() => boolean) | undefined, send: () => Promise<T>): Promise<T> {
  return inTurn(id, () => (alive && !alive() ? Promise.reject(dropped) : send()));
}

interface ListOptions {
  /** A path that answers only to a good key, for a provider whose list of
      models answers to anyone. */
  proof?: string;
  /** Refuse, without asking the server, if no key is saved. */
  needsKey?: boolean;
  alive?: () => boolean;
}

/** Asks a model provider which models it has, which proves the address
    answers. */
export function listModels(id: string, address: string, { proof, needsKey, alive }: ListOptions = {}): Promise<string[]> {
  return sendInTurn(id, alive, () => invoke("models_list", { id, address, proof, needsKey }));
}

/** Makes one search with the saved key, to prove the key works. */
export function testSearch(alive?: () => boolean): Promise<void> {
  return sendInTurn("search", alive, () => invoke("search_test"));
}
