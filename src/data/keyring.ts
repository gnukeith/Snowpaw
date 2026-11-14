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

/** Runs `call` once every earlier call about the key `id` has finished. */
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

/** Asks a model provider which models it has, which proves the address
    answers. `proof` is a path that answers only to a good key, for a provider
    whose list answers to anyone. */
export function listModels(id: string, address: string, proof?: string): Promise<string[]> {
  return inTurn(id, () => invoke("models_list", { id, address, proof }));
}

/** Makes one search with the saved key, to prove the key works. */
export function testSearch(): Promise<void> {
  return inTurn("search", () => invoke("search_test"));
}
