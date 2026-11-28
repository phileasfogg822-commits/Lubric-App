#!/usr/bin/env node
/**
 * Trial activation-code generator for lubric.app (batch 16).
 *
 * Run by UMAR ONLY, on his own PC — never on a customer PC, never in the
 * repo's CI. It mints the codes that unlock or extend a customer's trial.
 * No internet needed. No npm dependencies — plain Node (v18+) built-ins.
 *
 *   node scripts/trial-codegen.mjs keygen --out ./trial-private-key.pem
 *   node scripts/trial-codegen.mjs extend --key ./trial-private-key.pem [--days 7]
 *   node scripts/trial-codegen.mjs unlock --key ./trial-private-key.pem
 *   node scripts/trial-codegen.mjs check --key ./trial-private-key.pem <CODE>
 *
 * The private key is an Ed25519 key. KEEP IT SECRET and never commit it:
 * anyone with it can mint unlimited unlock codes. The app only carries the
 * PUBLIC key (src/lib/trialCore.ts), so it can verify codes offline but can
 * never mint one. Each code carries 4 random nonce bytes, so every code is
 * different even for the same kind, and the app rejects a code the second
 * time it is entered.
 *
 * Code format (mirrors src/lib/trialCore.ts — the server sim cross-checks
 * the two, so if this file and trialCore.ts ever drift the sim goes red):
 *   type (1 byte: 'E' extend / 'U' unlock) | days (1 byte) |
 *   nonce (4 random bytes) | Ed25519 signature (64 bytes)
 * over the message "LUBRIC-TRIAL-V1" + type + days + nonce, encoded in
 * Crockford base32 (no I/L/O/U) grouped in 5s with dashes.
 */

import { generateKeyPairSync, createPrivateKey, createPublicKey, sign, verify, randomBytes } from "node:crypto";
import { writeFileSync, readFileSync, existsSync, chmodSync } from "node:fs";

const DOMAIN = "LUBRIC-TRIAL-V1";
const TYPE_EXTEND = 0x45; // 'E'
const TYPE_UNLOCK = 0x55; // 'U'
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function base32Encode(bytes) {
  let out = "";
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < bytes.length; i++) {
    buffer = (buffer << 8) | bytes[i];
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += CROCKFORD[(buffer >> bits) & 31];
    }
  }
  if (bits > 0) out += CROCKFORD[(buffer << (5 - bits)) & 31];
  return out;
}

function base32Decode(text) {
  const clean = text.toUpperCase().replace(/[-\s]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
  let buffer = 0;
  let bits = 0;
  const out = [];
  for (let i = 0; i < clean.length; i++) {
    const v = CROCKFORD.indexOf(clean[i]);
    if (v === -1) throw new Error(`bad code character: ${clean[i]}`);
    buffer = (buffer << 5) | v;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 255);
    }
  }
  return Buffer.from(out);
}

function parseCode(input) {
  const raw = base32Decode(input);
  if (raw.length !== 70) throw new Error(`bad code length: ${raw.length} bytes`);
  const type = raw[0];
  if (type !== TYPE_EXTEND && type !== TYPE_UNLOCK) throw new Error(`unknown code type: ${type}`);
  return { type, days: raw[1], nonce: raw.subarray(2, 6), signature: raw.subarray(6, 70) };
}

function groupCode(encoded) {
  return encoded.replace(/(.{5})(?=.)/g, "$1-");
}

function codeMessage(type, days, nonce) {
  const domain = Buffer.from(DOMAIN, "ascii");
  const msg = Buffer.alloc(domain.length + 2 + nonce.length);
  domain.copy(msg, 0);
  msg[domain.length] = type;
  msg[domain.length + 1] = days;
  Buffer.from(nonce).copy(msg, domain.length + 2);
  return msg;
}

function mintCode(privateKey, type, days) {
  const nonce = randomBytes(4);
  const msg = codeMessage(type, days, nonce);
  const sig = sign(null, msg, privateKey);
  const raw = Buffer.alloc(1 + 1 + 4 + 64);
  raw[0] = type;
  raw[1] = days;
  nonce.copy(raw, 2);
  sig.copy(raw, 6);
  return groupCode(base32Encode(raw));
}

function loadPrivateKey(path) {
  if (!existsSync(path)) {
    console.error(`private key not found: ${path}`);
    console.error("make one first: node scripts/trial-codegen.mjs keygen --out ./trial-private-key.pem");
    process.exit(1);
  }
  return createPrivateKey(readFileSync(path, "utf8"));
}

function publicKeyHex(privateKey) {
  const pub = createPublicKey(privateKey);
  const spki = pub.export({ type: "spki", format: "der" });
  return Buffer.from(spki.subarray(spki.length - 32)).toString("hex");
}

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const cmd = process.argv[2];

if (cmd === "keygen") {
  const out = arg("--out", "./trial-private-key.pem");
  if (existsSync(out)) {
    console.error(`refusing to overwrite existing key: ${out}`);
    process.exit(1);
  }
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  writeFileSync(out, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
  try { chmodSync(out, 0o600); } catch { /* Windows has no chmod */ }
  console.log(`private key written to ${out} — KEEP IT SECRET, never commit it.`);
  console.log(`public key (hex — must match TRIAL_PUBLIC_KEY_HEX in src/lib/trialCore.ts):`);
  console.log(publicKeyHex(privateKey));
} else if (cmd === "extend" || cmd === "unlock") {
  const keyPath = arg("--key", "./trial-private-key.pem");
  const key = loadPrivateKey(keyPath);
  if (cmd === "extend") {
    const days = Number(arg("--days", "7"));
    if (!Number.isInteger(days) || days < 1 || days > 255) {
      console.error("--days must be a whole number 1..255");
      process.exit(1);
    }
    console.log(mintCode(key, TYPE_EXTEND, days));
    console.log(`(extend code — adds ${days} day${days === 1 ? "" : "s"} from today or from the current expiry, whichever is later; single-use)`);
  } else {
    console.log(mintCode(key, TYPE_UNLOCK, 0));
    console.log("(unlock code — permanent, trial gone forever; single-use)");
  }
} else if (cmd === "check") {
  const keyPath = arg("--key", "./trial-private-key.pem");
  const key = loadPrivateKey(keyPath);
  // The code is the positional argument (not the --key value).
  const positional = process.argv.slice(3).filter((a, i, arr) => a !== keyPath && arr[i - 1] !== "--key");
  const code = positional.find((a) => !a.startsWith("--"));
  if (!code) {
    console.error("usage: node scripts/trial-codegen.mjs check --key ./trial-private-key.pem <CODE>");
    process.exit(1);
  }
  // Real verification with the public key derived from the private key: a
  // code this tool minted must verify, a foreign or mistyped code must not.
  try {
    const parsed = parseCode(code);
    const pub = createPublicKey(key);
    const good = verify(null, codeMessage(parsed.type, parsed.days, parsed.nonce), pub, parsed.signature);
    console.log(`code: ${code}`);
    console.log(`type: ${parsed.type === TYPE_EXTEND ? `extend (${parsed.days} days)` : "unlock (permanent)"}`);
    console.log(good ? "VALID — this code was minted with your key." : "INVALID — signature mismatch (foreign or mistyped code).");
    process.exit(good ? 0 : 1);
  } catch (e) {
    console.log(`code: ${code}`);
    console.log(`INVALID — ${e.message}`);
    process.exit(1);
  }
} else {
  console.log("usage:");
  console.log("  node scripts/trial-codegen.mjs keygen --out ./trial-private-key.pem");
  console.log("  node scripts/trial-codegen.mjs extend --key ./trial-private-key.pem [--days 7]");
  console.log("  node scripts/trial-codegen.mjs unlock --key ./trial-private-key.pem");
  console.log("  node scripts/trial-codegen.mjs check --key ./trial-private-key.pem <CODE>");
  process.exit(1);
}
