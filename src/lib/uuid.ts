/**
 * Client-generated UUIDs.
 *
 * `uuid` is the sync key (see server/migrations/012_sync.sql): the cloud upserts
 * every replicated row by it. A row pushed twice must present the same key, or
 * the retry lands as a second row — which for the khata would mean duplicated
 * money. So every locally-created row needs a uuid BEFORE it is queued.
 */
export function newUuid(): string {
  const c: Crypto | undefined = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();

  // randomUUID() is only exposed in a secure context, and a Tauri desktop build
  // can be served over http://ipc.localhost. getRandomValues() is always
  // available, so fall back to it rather than shipping a row with no key.
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === "function") {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10xx

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const HEX = "0123456789ABCDEF";

/**
 * A one-time device pairing code: 8 uppercase hex characters, the same shape
 * `server/pair.js` prints, so a code made in the app and one made over SSH are
 * interchangeable.
 *
 * Lives here rather than in lib/pairing.ts because that module imports the data
 * layer, which reads `import.meta.env` and therefore cannot be loaded outside a
 * bundler. Keeping this pure is what lets server/e2e_pairing.js test the real
 * generator rather than a copy of it.
 */
export function newPairingCode(): string {
  const bytes = new Uint8Array(4);
  const c: Crypto | undefined = globalThis.crypto;
  if (c && typeof c.getRandomValues === "function") {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 4; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => HEX[b >> 4] + HEX[b & 15]).join("");
}
