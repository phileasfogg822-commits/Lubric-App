/**
 * Batch 16 trial licensing — activation codes (Umar, 2026-11-28).
 *
 * Codes are Ed25519-signed by Umar only (scripts/trial-codegen.mjs) and
 * verified offline against the public key baked into src/lib/trialCore.ts.
 * Each code is different (4 random nonce bytes) and single-use; an EXTEND
 * code adds days from max(today, current expiry) and an UNLOCK code unlocks
 * forever. This sim drives the REAL trialCore (imported, not copied) and
 * cross-checks the REAL generator with a throwaway keypair, so a drift
 * between the generator's codec and the app's codec goes red here.
 *
 * The real keypair is NOT in the repo (public repo) and no real code is
 * committed here: a real code printed in a public file would be spendable.
 * The real extend/unlock examples were verified locally by the builder
 * against trialCore.verifyCode and are delivered to Umar privately.
 *
 * Run:  node --experimental-strip-types server/sim_trial_codes.js
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
} from "node:crypto";
import nacl from "tweetnacl";
import {
  CODE_TYPE_EXTEND,
  CODE_TYPE_UNLOCK,
  applyCode,
  base32Decode,
  base32Encode,
  codeId,
  codeMessage,
  computeTrialState,
  groupCode,
  normalizeCode,
  parseCode,
  verifyCode,
} from "../src/lib/trialCore.ts";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

let ok = 0, total = 0, failed = 0;
function check(title, fn) {
  total++;
  try { fn(); ok++; console.log(`  PASS ${title}`); }
  catch (e) { failed++; console.log(`  FAIL ${title}: ${e.message}`); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }
function assertEq(a, b, msg) { if (a !== b) throw new Error(`${msg}: got ${a}, want ${b}`); }

/** Raw 32-byte public key out of a SPKI DER blob (last 32 bytes). */
function rawPublicKey(publicKey) {
  const spki = publicKey.export({ type: "spki", format: "der" });
  return new Uint8Array(spki.subarray(spki.length - 32));
}

function throwawayKeypair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return { publicKey, privateKey, rawPub: rawPublicKey(publicKey) };
}

function signWith(privateKey, type, days, nonce) {
  return sign(null, codeMessage(type, days, nonce), privateKey);
}

/** Hand-assemble a code from parts (same codec as the app + generator). */
function assembleCode(type, days, nonce, signature) {
  const raw = new Uint8Array(70);
  raw[0] = type;
  raw[1] = days;
  raw.set(nonce, 2);
  raw.set(signature, 6);
  return groupCode(base32Encode(raw));
}

// ── codec ──────────────────────────────────────────────────────────────────
check("base32 round-trips arbitrary bytes", () => {
  const bytes = new Uint8Array([0, 1, 2, 127, 128, 200, 255, 69, 42]);
  assertEq(base32Decode(base32Encode(bytes)).join(","), bytes.join(","), "round-trip");
});

check("code groups in 5s, Crockford alphabet only (no I/L/O/U)", () => {
  const bytes = new Uint8Array(70);
  for (let i = 0; i < 70; i++) bytes[i] = (i * 37 + 11) % 256;
  const grouped = groupCode(base32Encode(bytes));
  assert(!/[ILOU]/.test(grouped), "no confusing letters");
  assert(/^([0-9A-HJKMNP-TV-Z]{5}-)+[0-9A-HJKMNP-TV-Z]{2}$/.test(grouped), `group shape: ${grouped}`);
  assertEq(normalizeCode(grouped.toLowerCase().replace(/-/g, " ")), base32Encode(bytes), "normalize is forgiving");
});

// ── the REAL generator, throwaway key ───────────────────────────────────────
const workdir = mkdtempSync(join(tmpdir(), "trial-codes-"));
const keyPath = join(workdir, "trial-private-key.pem");
let genExtend = "", genUnlock = "";
try {
  execFileSync("node", ["scripts/trial-codegen.mjs", "keygen", "--out", keyPath], { cwd: REPO_ROOT, encoding: "utf8" });
  genExtend = execFileSync("node", ["scripts/trial-codegen.mjs", "extend", "--key", keyPath, "--days", "7"], { cwd: REPO_ROOT, encoding: "utf8" }).split("\n")[0].trim();
  genUnlock = execFileSync("node", ["scripts/trial-codegen.mjs", "unlock", "--key", keyPath], { cwd: REPO_ROOT, encoding: "utf8" }).split("\n")[0].trim();
} finally {
  // The throwaway key never leaves this temp dir; removed at the end.
}

check("generator mints a parseable extend code (7 days, nonce present)", () => {
  const p = parseCode(genExtend);
  assertEq(p.type, CODE_TYPE_EXTEND, "type");
  assertEq(p.days, 7, "days");
  assertEq(p.nonce.length, 4, "nonce length");
  assertEq(p.signature.length, 64, "signature length");
});

check("generator mints a parseable unlock code (days 0)", () => {
  const p = parseCode(genUnlock);
  assertEq(p.type, CODE_TYPE_UNLOCK, "type");
  assertEq(p.days, 0, "days");
});

check("generator codes verify under tweetnacl with the throwaway public key", () => {
  const priv = createPrivateKey(readFileSync(keyPath, "utf8"));
  const rawPub = rawPublicKey(createPublicKey(priv));
  for (const code of [genExtend, genUnlock]) {
    const p = parseCode(code);
    assert(
      nacl.sign.detached.verify(codeMessage(p.type, p.days, p.nonce), p.signature, rawPub),
      "signature verifies"
    );
  }
});

check("two generator codes are different (nonce)", () => {
  assert(genExtend !== genUnlock, "codes differ");
  const again = execFileSync("node", ["scripts/trial-codegen.mjs", "extend", "--key", keyPath, "--days", "7"], { cwd: REPO_ROOT, encoding: "utf8" }).split("\n")[0].trim();
  assert(again !== genExtend, "same kind minted twice still differs");
});

check("generator check command verifies a good code and rejects a flipped one", () => {
  execFileSync("node", ["scripts/trial-codegen.mjs", "check", "--key", keyPath, genExtend], { cwd: REPO_ROOT, encoding: "utf8" });
  const idx = genExtend[3] === "-" ? 4 : 3;
  const flipped = genExtend.slice(0, idx) + (genExtend[idx] === "A" ? "B" : "A") + genExtend.slice(idx + 1);
  let threw = false;
  try {
    execFileSync("node", ["scripts/trial-codegen.mjs", "check", "--key", keyPath, flipped], { cwd: REPO_ROOT, encoding: "utf8", stdio: "pipe" });
  } catch { threw = true; }
  assert(threw, "check must exit non-zero on a flipped code");
});

check("generator refuses to overwrite an existing private key", () => {
  let threw = false;
  try {
    execFileSync("node", ["scripts/trial-codegen.mjs", "keygen", "--out", keyPath], { cwd: REPO_ROOT, encoding: "utf8", stdio: "pipe" });
  } catch { threw = true; }
  assert(threw, "keygen must refuse an existing key file");
});

// ── the app's verifier: foreign + tampered codes ────────────────────────────
check("a code signed by a foreign key FAILS verifyCode (not Umar's key)", () => {
  const { privateKey } = throwawayKeypair();
  const code = assembleCode(CODE_TYPE_EXTEND, 7, new Uint8Array([1, 2, 3, 4]), signWith(privateKey, CODE_TYPE_EXTEND, 7, new Uint8Array([1, 2, 3, 4])));
  assert(!verifyCode(code).ok, "foreign signature must not verify");
});

check("a tampered code (one character flipped) FAILS signature verification", () => {
  const { privateKey, rawPub } = throwawayKeypair();
  const nonce = new Uint8Array([9, 8, 7, 6]);
  const code = assembleCode(CODE_TYPE_UNLOCK, 0, nonce, signWith(privateKey, CODE_TYPE_UNLOCK, 0, nonce));
  const p = parseCode(code);
  assert(nacl.sign.detached.verify(codeMessage(p.type, p.days, p.nonce), p.signature, rawPub), "unflipped code verifies");
  // Flip one payload character (not a dash): the signature must break.
  const idx = code[3] === "-" ? 4 : 3;
  const flipped = code.slice(0, idx) + (code[idx] === "A" ? "B" : "A") + code.slice(idx + 1);
  const q = parseCode(flipped);
  assert(!nacl.sign.detached.verify(codeMessage(q.type, q.days, q.nonce), q.signature, rawPub), "flipped code must not verify");
  assert(!verifyCode(flipped).ok, "flipped code must not verify against the app key either");
});

check("garbage, short and wrong-type codes are rejected, not thrown", () => {
  for (const bad of ["hello", "AAAAA-BBBBB", "", "ZZZZZ-YYYYY"]) {
    assert(!verifyCode(bad).ok, `${JSON.stringify(bad)} must fail`);
  }
});

// ── applying codes ──────────────────────────────────────────────────────────
// A code that verifies against the REAL baked-in key cannot be forged here
// (the private key is not in the repo), so the apply path's accept branch
// is proven by the builder's local check with real codes; here the sim
// proves the reject branch and the spent-code identity.
check("applyCode rejects an unverifiable code without changing state", () => {
  const s0 = computeTrialState({ first: "2026-11-28", lastSeen: "2026-11-28", expiry: null, unlocked: false, used: [] }, "2026-11-28");
  const r = applyCode(s0, "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "2026-11-28");
  assert(!r.ok, "must reject");
  assertEq(s0.status, "trial", "state untouched");
});

check("codeId is stable and differs per code (spent-code identity)", () => {
  const a = codeId(genExtend);
  const b = codeId(genUnlock);
  assertEq(a, codeId(genExtend), "stable");
  assert(a !== b, "different codes, different ids");
  assertEq(a.length, 128, "SHA-512 hex length");
});

rmSync(workdir, { recursive: true, force: true });

console.log(`\n${ok}/${total} checks passed (${failed} failed)`);
if (failed > 0) process.exit(1);
