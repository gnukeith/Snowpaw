import { invoke } from "@tauri-apps/api/core";

/* What the page may ask the Rust side about keys and the servers they are
   for. There is no way to read a key back: the page can save one, ask whether
   one is saved, forget it, and have a request made with it. A key is saved
   for one address and is only ever sent there. Each call fails with a
   `Failure` from connections.ts. */

/** Saves the key for a connection, replacing any it had. */
export function saveKey(id: string, address: string, key: string): Promise<void> {
  return invoke("key_save", { id, address, key });
}

/** Whether a key is saved for this connection at this address. */
export function hasKey(id: string, address: string): Promise<boolean> {
  return invoke("key_exists", { id, address });
}

export function forgetKey(id: string): Promise<void> {
  return invoke("key_forget", { id });
}

/** Asks a model provider which models it has, which proves the address
    answers. `proof` is a path that answers only to a good key, for a provider
    whose list answers to anyone. */
export function listModels(id: string, address: string, proof?: string): Promise<string[]> {
  return invoke("models_list", { id, address, proof });
}

/** Makes one search with the saved key, to prove the key works. */
export function testSearch(): Promise<void> {
  return invoke("search_test");
}
