/**
 * Batch 16 (2026-11-28): trial licensing — pure core, no DOM, no Tauri.
 *
 * The trial is 7 days from FIRST LAUNCH. The first-launch date is kept in
 * several places OUTSIDE the app's own database (temp file, %PROGRAMDATA%,
 * the registry, WebView2 localStorage, a log file — see src/lib/trial.ts and
 * src-tauri/src/trial_markers.rs), so wiping the database or reinstalling
 * does NOT restart the clock: the earliest first date ever seen wins.
 *
 * Activation codes are Ed25519-signed by Umar only. The PUBLIC key below is
 * baked in for offline verification; the private key never ships in the
 * repo (public repo — it lives with Umar and the code-generator script,
 * scripts/trial-codegen.mjs). A code is one signed payload:
 *
 *   type (1 byte: 'E' extend / 'U' unlock) | days (1 byte) |
 *   nonce (4 random bytes, so every code is different) |
 *   Ed25519 signature (64 bytes) over "LUBRIC-TRIAL-V1" + type + days + nonce
 *
 * 70 bytes, Crockford base32, grouped in 5s with dashes so it can be read
 * over WhatsApp or the phone and pasted into the lock screen. Codes are
 * single-use: the app stores the SHA-512 of each used code and rejects it
 * a second time. A tampered code fails the signature; a code signed by any
 * other key fails the signature too.
 *
 * This file is deliberately erasable TypeScript (type annotations only, no
 * enums / namespaces / parameter properties) so the server sims can import
 * the REAL code with `node --experimental-strip-types`.
 */

import nacl from "tweetnacl";

/** Ed25519 public key (32 bytes, hex). Verification only. */
export const TRIAL_PUBLIC_KEY_HEX =
  "2794ceeced2358b0a64563fd7add8256715e75f84cca12eebb42ed581b69ab95";

/** Trial length in days, from first launch. */
export const TRIAL_DAYS = 7;

/** Domain separator signed into every code. */
export const TRIAL_CODE_DOMAIN = "LUBRIC-TRIAL-V1";

export const CODE_TYPE_EXTEND = 0x45; // ASCII 'E'
export const CODE_TYPE_UNLOCK = 0x55; // ASCII 'U'

/** One stored first-launch record, from any of the marker locations. */
export interface TrialMarker {
  first: string | null; // YYYY-MM-DD of first launch, or null if unknown
  lastSeen: string | null; // YYYY-MM-DD of the latest launch seen
  expiry: string | null; // explicit expiry (YYYY-MM-DD) after an extension
  unlocked: boolean; // a permanent unlock code was applied
  used: string[]; // SHA-512 hex of each spent activation code
}

export type TrialStatus =
  | "trial" // inside the trial window
  | "expired" // trial window over, no valid code entered
  | "unlocked" // permanent unlock code applied
  | "tampered" // the clock moved backwards past the last-seen date
  | "inactive"; // not a Tauri build — the trial does not apply

export interface TrialState {
  status: TrialStatus;
  firstDate: string | null;
  expiryDate: string | null; // first + 7 days, or the extended expiry
  daysLeft: number; // whole days remaining (7 on the first-launch day)
  tampered: boolean;
  unlocked: boolean;
  used: string[];
  lastSeen: string | null;
}

export function emptyMarker(): TrialMarker {
  return { first: null, lastSeen: null, expiry: null, unlocked: false, used: [] };
}

// ── dates (UTC, date-only — the trial counts calendar days) ────────────────

const DAY_MS = 24 * 60 * 60 * 1000;

export function todayString(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function parseDay(iso: string): number {
  const ms = Date.parse(iso + "T00:00:00.000Z");
  if (Number.isNaN(ms)) throw new Error(`bad date: ${iso}`);
  return ms;
}

export function formatDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  return formatDay(parseDay(iso) + days * DAY_MS);
}

/** Whole days from `a` to `b` (b − a). Negative when b is before a. */
export function diffDays(a: string, b: string): number {
  return Math.round((parseDay(b) - parseDay(a)) / DAY_MS);
}

// ── Crockford base32 (no I/L/O/U — safe to read over the phone) ───────────

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function base32Encode(bytes: Uint8Array): string {
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

export function base32Decode(text: string): Uint8Array {
  // Forgiving reads: Crockford maps O→0 and I/L→1, so a code read aloud
  // still decodes.
  const clean = text
    .toUpperCase()
    .replace(/[-\s]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
  let buffer = 0;
  let bits = 0;
  const out: number[] = [];
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
  // Trailing bits must be zero padding, never a hidden extra byte.
  if (bits > 0 && ((buffer << (8 - bits)) & 255) !== 0) {
    throw new Error("bad code padding");
  }
  return new Uint8Array(out);
}

/** Group a base32 code in 5s with dashes for reading / pasting. */
export function groupCode(encoded: string): string {
  return encoded.replace(/(.{5})(?=.)/g, "$1-");
}

export function normalizeCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[-\s]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
}

// ── activation codes ───────────────────────────────────────────────────────

/** Bytes the signature covers: domain + type + days + nonce. */
export function codeMessage(type: number, days: number, nonce: Uint8Array): Uint8Array {
  const domain = new TextEncoder().encode(TRIAL_CODE_DOMAIN);
  const msg = new Uint8Array(domain.length + 2 + nonce.length);
  msg.set(domain, 0);
  msg[domain.length] = type;
  msg[domain.length + 1] = days;
  msg.set(nonce, domain.length + 2);
  return msg;
}

/** Encode a signed code (type + days + nonce + 64-byte signature). */
export function encodeCode(
  type: number,
  days: number,
  nonce: Uint8Array,
  signature: Uint8Array
): string {
  if (nonce.length !== 4) throw new Error("nonce must be 4 bytes");
  if (signature.length !== 64) throw new Error("signature must be 64 bytes");
  const raw = new Uint8Array(1 + 1 + 4 + 64);
  raw[0] = type;
  raw[1] = days;
  raw.set(nonce, 2);
  raw.set(signature, 6);
  return groupCode(base32Encode(raw));
}

export interface ParsedCode {
  type: number;
  days: number;
  nonce: Uint8Array;
  signature: Uint8Array;
}

export function parseCode(input: string): ParsedCode {
  const raw = base32Decode(input);
  if (raw.length !== 70) throw new Error(`bad code length: ${raw.length} bytes`);
  const type = raw[0];
  if (type !== CODE_TYPE_EXTEND && type !== CODE_TYPE_UNLOCK) {
    throw new Error(`unknown code type: ${type}`);
  }
  const days = raw[1];
  if (type === CODE_TYPE_EXTEND && (days < 1 || days > 255)) {
    throw new Error(`bad extend days: ${days}`);
  }
  return {
    type,
    days,
    nonce: raw.slice(2, 6),
    signature: raw.slice(6, 70),
  };
}

export interface VerifiedCode {
  ok: boolean;
  reason?: string;
  type?: number;
  days?: number;
  nonce?: Uint8Array;
}

/** Offline verification against a given public key (hex). */
export function verifyCodeWithKey(input: string, publicKeyHex: string): VerifiedCode {
  let parsed: ParsedCode;
  try {
    parsed = parseCode(input);
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
  const pub = hexToBytes(publicKeyHex);
  const msg = codeMessage(parsed.type, parsed.days, parsed.nonce);
  if (!nacl.sign.detached.verify(msg, parsed.signature, pub)) {
    return { ok: false, reason: "signature mismatch — not a code from Umar" };
  }
  return { ok: true, type: parsed.type, days: parsed.days, nonce: parsed.nonce };
}

/** Offline verification against the baked-in public key. */
export function verifyCode(input: string): VerifiedCode {
  return verifyCodeWithKey(input, TRIAL_PUBLIC_KEY_HEX);
}

/** Identity of a code for the spent-code list (SHA-512, sync, no WebCrypto). */
export function codeId(input: string): string {
  return bytesToHex(nacl.hash(new TextEncoder().encode(normalizeCode(input))));
}

export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error("odd hex length");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0");
  return out;
}

// ── marker merge + trial state ─────────────────────────────────────────────

/**
 * Merge every marker found (temp, ProgramData, registry, localStorage, log).
 * The EARLIEST first date wins — that is what stops a reinstall from
 * restarting the clock. The LATEST last-seen wins, the LONGEST expiry wins,
 * and any unlock wins, so a stale marker can never shorten a trial or
 * re-lock an unlocked app. Used-code lists union.
 */
export function mergeMarkers(markers: TrialMarker[]): TrialMarker {
  const merged = emptyMarker();
  for (const m of markers) {
    if (m.first && (!merged.first || m.first < merged.first)) merged.first = m.first;
    if (m.lastSeen && (!merged.lastSeen || m.lastSeen > merged.lastSeen)) {
      merged.lastSeen = m.lastSeen;
    }
    if (m.expiry && (!merged.expiry || m.expiry > merged.expiry)) merged.expiry = m.expiry;
    if (m.unlocked) merged.unlocked = true;
    for (const h of m.used) if (!merged.used.includes(h)) merged.used.push(h);
  }
  return merged;
}

/**
 * The trial state for one launch. `marker` is the merged marker (null on a
 * genuine first launch — the caller then persists first = today). Pure:
 * no I/O, so the sims drive it with fixed dates.
 */
export function computeTrialState(marker: TrialMarker | null, today: string): TrialState {
  if (!marker || !marker.first) {
    return {
      status: "trial",
      firstDate: today,
      expiryDate: addDays(today, TRIAL_DAYS),
      daysLeft: TRIAL_DAYS,
      tampered: false,
      unlocked: false,
      used: marker ? [...marker.used] : [],
      lastSeen: today,
    };
  }
  const firstDate = marker.first;
  const expiryDate = marker.expiry ?? addDays(firstDate, TRIAL_DAYS);
  const lastSeen = marker.lastSeen ?? firstDate;
  const tampered = today < lastSeen || today < firstDate;
  const daysLeft = diffDays(today, expiryDate);
  let status: TrialStatus;
  if (tampered) status = "tampered";
  else if (marker.unlocked) status = "unlocked";
  else if (daysLeft <= 0) status = "expired";
  else status = "trial";
  return {
    status,
    firstDate,
    expiryDate,
    daysLeft: Math.max(0, daysLeft),
    tampered,
    unlocked: marker.unlocked,
    used: [...marker.used],
    lastSeen,
  };
}

/** Marker to persist after a launch (first + last-seen updated, rest kept). */
export function markerForLaunch(state: TrialState, today: string): TrialMarker {
  return {
    first: state.firstDate ?? today,
    lastSeen: today,
    expiry: state.expiryDate,
    unlocked: state.unlocked,
    used: [...state.used],
  };
}

export interface ActivationResult {
  ok: boolean;
  reason?: string;
  state?: TrialState;
  kind?: "extend" | "unlock";
  daysAdded?: number;
}

/**
 * Apply an activation code to a trial state. Extend counts from
 * max(today, current expiry) — a code entered mid-trial adds on top of the
 * time still left, never behind it. Unlock is permanent. Reuse is rejected
 * by the spent-code list, and a code that fails the signature is rejected
 * before anything changes.
 */
export function applyCode(
  state: TrialState,
  input: string,
  today: string
): ActivationResult {
  return applyCodeWithKey(state, input, today, TRIAL_PUBLIC_KEY_HEX);
}

/**
 * Same as applyCode, but the verifying key is a parameter — the sims drive
 * the REAL accept path with a throwaway keypair (the real private key is
 * not in the repo, so no real code can be forged in CI). The app path
 * always uses the baked-in key via applyCode.
 */
export function applyCodeWithKey(
  state: TrialState,
  input: string,
  today: string,
  publicKeyHex: string
): ActivationResult {
  const verified = verifyCodeWithKey(input, publicKeyHex);
  if (!verified.ok || verified.type === undefined) {
    return { ok: false, reason: verified.reason ?? "invalid code" };
  }
  const id = codeId(input);
  if (state.used.includes(id)) {
    return { ok: false, reason: "this code has already been used" };
  }
  const used = [...state.used, id];
  if (verified.type === CODE_TYPE_UNLOCK) {
    return {
      ok: true,
      kind: "unlock",
      state: {
        ...state,
        status: "unlocked",
        unlocked: true,
        tampered: false,
        used,
        lastSeen: today,
      },
    };
  }
  const days = verified.days ?? TRIAL_DAYS;
  const base = !state.expiryDate || state.expiryDate < today ? today : state.expiryDate;
  const expiryDate = addDays(base, days);
  const next: TrialState = {
    ...state,
    status: "trial",
    expiryDate,
    daysLeft: diffDays(today, expiryDate),
    tampered: false,
    used,
    lastSeen: today,
  };
  return { ok: true, kind: "extend", daysAdded: days, state: next };
}
