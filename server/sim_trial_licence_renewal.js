/**
 * Batch 16.1 trial licensing — the 1-year licence, the login-screen code
 * box, and the keep-data uninstall question (Umar, 2026-11-28).
 *
 * Rules as built:
 *   - UNLOCK is a 1-YEAR LICENCE (365 days from max(today, current
 *     expiry)), not forever. A code minted under batch 16 (days byte 0)
 *     still verifies and now means 1 year.
 *   - When the year runs out the app locks to a renew screen that says to
 *     contact grafixers.co.uk, with the code box; a new unlock code
 *     renews for another year.
 *   - The login screen has a "Have an activation code?" link that opens
 *     the same activation form as the lock screen (same verifier, same
 *     single-use rules) — a customer who buys early never has to wait
 *     for expiry to unlock. Login shows "Licensed until <date>".
 *   - Uninstall asks once (Yes/No, wipe is the default) whether to keep
 *     the shop data. Keeping the data does NOT reset the trial clock —
 *     the markers live outside the app data dir either way.
 *   - The trial applies ONLY to the Windows Tauri build (isTauri gate).
 *
 * The state machine is driven through the REAL trialCore (imported). The
 * accept path of applyCode is driven with a throwaway keypair via
 * applyCodeWithKey (the real private key is not in the repo); the reject
 * path goes through the real baked-in key via applyCode. The wiring (login
 * link, lock wording, NSIS hooks) is checked against the real source files.
 *
 * Run:  node --experimental-strip-types server/sim_trial_licence_renewal.js
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { generateKeyPairSync, sign } from "node:crypto";
import {
  CODE_TYPE_EXTEND,
  CODE_TYPE_UNLOCK,
  LICENSE_DAYS,
  applyCode,
  applyCodeWithKey,
  bytesToHex,
  codeMessage,
  computeTrialState,
  encodeCode,
  markerForLaunch,
} from "../src/lib/trialCore.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(ROOT + p, "utf8");

let ok = 0, total = 0, failed = 0;
function check(title, fn) {
  total++;
  try { fn(); ok++; console.log(`  PASS ${title}`); }
  catch (e) { failed++; console.log(`  FAIL ${title}: ${e.message}`); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }
function assertEq(a, b, msg) { if (a !== b) throw new Error(`${msg}: got ${a}, want ${b}`); }

function marker(first, lastSeen, extra = {}) {
  return { first, lastSeen, expiry: null, unlocked: false, used: [], ...extra };
}

/** Mint a code with a throwaway keypair, using the REAL codec. */
function mintTestCode(type, days) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const spki = publicKey.export({ type: "spki", format: "der" });
  const pubHex = bytesToHex(new Uint8Array(spki.subarray(spki.length - 32)));
  const nonce = new Uint8Array([3, 1, 4, 1]);
  const sig = sign(null, codeMessage(type, days, nonce), privateKey);
  return { code: encodeCode(type, days, nonce, sig), pubHex };
}

// ── the 1-year licence ──────────────────────────────────────────────────────
check("LICENSE_DAYS is 365", () => {
  assertEq(LICENSE_DAYS, 365, "a licence is one year");
});

check("unlock mid-trial keeps the trial's remaining days (expiry + 365)", () => {
  const { code, pubHex } = mintTestCode(CODE_TYPE_UNLOCK, 0);
  const s0 = computeTrialState(marker("2026-11-28", "2026-12-01"), "2026-12-01");
  assertEq(s0.expiryDate, "2026-12-05", "trial expiry before unlock");
  assertEq(s0.daysLeft, 4, "4 trial days left");
  const r = applyCodeWithKey(s0, code, "2026-12-01", pubHex);
  assert(r.ok, "must accept");
  assertEq(r.kind, "unlock", "kind");
  assertEq(r.state.expiryDate, "2027-12-05", "licence runs to old expiry + 365");
  assertEq(r.state.daysLeft, 369, "days left after unlock");
  assertEq(r.state.status, "unlocked", "licensed");
});

check("an unlock code minted under batch 16 (days byte 0) still verifies and means 1 year", () => {
  // Batch 16 minted unlock codes with days = 0 and the app treated them
  // as permanent. The wire format is unchanged; only the meaning moved.
  // The one code already sent to Umar must work under this build — as a
  // 1-year licence, not forever.
  const { code, pubHex } = mintTestCode(CODE_TYPE_UNLOCK, 0);
  const s0 = computeTrialState(marker("2026-11-28", "2026-11-28"), "2026-11-28");
  const r = applyCodeWithKey(s0, code, "2026-11-28", pubHex);
  assert(r.ok, "old-format unlock code must still verify");
  // Same max-rule as extend: the licence stacks on the trial expiry
  // (2026-12-05), so the trial's 7 days are not lost.
  assertEq(r.state.expiryDate, "2027-12-05", "old code grants one year from the current expiry");
});

check("licence expiry locks to licence_expired (not trial-expired), the day before it is still licensed", () => {
  const m = marker("2026-11-28", "2027-11-27", { expiry: "2027-11-28", unlocked: true });
  assertEq(computeTrialState(m, "2027-11-27").status, "unlocked", "day before expiry");
  const s = computeTrialState(marker("2026-11-28", "2027-11-28", { expiry: "2027-11-28", unlocked: true }), "2027-11-28");
  assertEq(s.status, "licence_expired", "licence_expired on the expiry day");
  assertEq(s.expiryDate, "2027-11-28", "expiry date carried for the renew screen");
});

check("a new unlock code renews an expired licence for another year from today", () => {
  const { code, pubHex } = mintTestCode(CODE_TYPE_UNLOCK, 0);
  const s0 = computeTrialState(marker("2026-11-28", "2027-11-28", { expiry: "2027-11-28", unlocked: true }), "2027-11-30");
  assertEq(s0.status, "licence_expired", "expired first");
  const r = applyCodeWithKey(s0, code, "2027-11-30", pubHex);
  assert(r.ok, "renewal must accept");
  assertEq(r.kind, "unlock", "kind");
  // 2027-11-30 + 365 days = 2028-11-29 (2028 is a leap year, so the
  // 365-day span lands a day short of the same calendar date).
  assertEq(r.state.expiryDate, "2028-11-29", "another year from today");
  assertEq(r.state.status, "unlocked", "licensed again");
});

check("an extend code still works inside a licence (adds days on top)", () => {
  const { code, pubHex } = mintTestCode(CODE_TYPE_EXTEND, 7);
  const s0 = computeTrialState(marker("2026-11-28", "2027-06-01", { expiry: "2027-11-28", unlocked: true }), "2027-06-01");
  assertEq(s0.status, "unlocked", "licensed first");
  const r = applyCodeWithKey(s0, code, "2027-06-01", pubHex);
  assert(r.ok, "must accept");
  assertEq(r.kind, "extend", "kind");
  assertEq(r.state.expiryDate, "2027-12-05", "extend adds 7 days to the licence expiry");
  assertEq(r.state.status, "unlocked", "still licensed after extend");
});

// ── the login-screen code box ───────────────────────────────────────────────
check("login screen offers the code box any time (trial or licensed)", () => {
  const login = read("src/modules/auth/Login.tsx");
  assert(/Have an activation code\?/.test(login), "link text");
  assert(/showCode/.test(login), "link toggles the form");
  assert(/ActivationCodeForm/.test(login), "shared form rendered on login");
  assert(/trial\.status === "trial" \|\| trial\.status === "unlocked"/.test(login), "link shown in trial and licensed states");
  assert(!/trial\.status === "expired"/.test(login), "a locked install never reaches login — no code box needed there");
});

check("lock screen and login share ONE activation form (same verifier, same rules)", () => {
  const form = read("src/components/ActivationCodeForm.tsx");
  assert(/activateTrialCode/.test(form), "form calls the shared activation path");
  assert(/Licensed until \$\{res\.state\?\.expiryDate/.test(form), "unlock success shows the licence end date");
  assert(/Trial extended by/.test(form), "extend success message");
  const lock = read("src/components/TrialLock.tsx");
  assert(/ActivationCodeForm/.test(lock), "lock screen uses the shared form");
  assert(!/activateTrialCode/.test(lock), "lock screen has no second copy of the logic");
  const login = read("src/modules/auth/Login.tsx");
  assert(!/activateTrialCode\(/.test(login), "login has no second copy either — the form owns it");
});

check("login-screen activation accepts a valid code and rejects reuse/tamper (same path as the lock screen)", () => {
  // The login form and the lock screen both call activateTrialCode, which
  // is applyCode against the baked-in key. The accept path is proven with
  // a throwaway key here; the reject path with the real key.
  const good = mintTestCode(CODE_TYPE_EXTEND, 7);
  const s0 = computeTrialState(marker("2026-11-28", "2026-12-01"), "2026-12-01");
  const r1 = applyCodeWithKey(s0, good.code, "2026-12-01", good.pubHex);
  assert(r1.ok, "valid extend accepted on the login path");
  const r2 = applyCodeWithKey(r1.state, good.code, "2026-12-01", good.pubHex);
  assert(!r2.ok, "reuse rejected on the login path");
  const bad = applyCode(s0, "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "2026-12-01");
  assert(!bad.ok, "garbage rejected on the login path");
});

// ── the renew screen wording ────────────────────────────────────────────────
check("licence-expiry lock tells the user to renew at grafixers.co.uk", () => {
  const lock = read("src/components/TrialLock.tsx");
  assert(/licence_expired/.test(lock), "lock screen knows the licence_expired reason");
  assert(/Your licence has ended/.test(lock), "renew heading");
  assert(/grafixers\.co\.uk/.test(lock), "renew points at grafixers.co.uk");
  assert(/To renew, contact Grafixers/.test(lock), "renew instruction");
  assert(/Licence ended \$\{initial\.expiryDate\}/.test(lock), "renew screen shows the end date");
  const app = read("src/App.tsx");
  assert(/licence_expired/.test(app), "gate passes licence_expired to the lock screen");
});

check("login shows 'Licensed until <date>' while licensed", () => {
  const login = read("src/modules/auth/Login.tsx");
  assert(/Licensed until \{trial\.expiryDate\}/.test(login), "licensed line with the date");
  assert(!/>\s*Licensed\s*</.test(login), "no bare 'Licensed' line left");
});

// ── keep-data uninstall ─────────────────────────────────────────────────────
check("uninstall asks to keep the data, wipe stays the default, silent uninstalls wipe", () => {
  const hooks = read("src-tauri/nsis-hooks.nsh");
  assert(/Var KEEP_DATA/.test(hooks), "keep-data flag declared");
  assert(/StrCpy \$KEEP_DATA "0"/.test(hooks), "default is wipe");
  assert(/IfSilent lubric_keepdata_done/.test(hooks), "silent uninstall never prompts");
  assert(/MessageBox MB_YESNO\|MB_ICONQUESTION "Keep my shop data/.test(hooks), "Yes/No question");
  assert(/StrCpy \$KEEP_DATA "1"/.test(hooks), "Yes keeps the data");
  assert(/StrCmp \$KEEP_DATA "1" lubric_keepdata_skip/.test(hooks), "wipe skipped when kept");
  assert(!/!macro NSIS_HOOK_(PRE|POST)INSTALL/.test(hooks), "install/upgrade never touches the data dir");
});

check("keeping the data does NOT reset the trial clock (markers live outside the data dir)", () => {
  // A licensed install is uninstalled with "keep my shop data" and
  // reinstalled a month later: the database is intact AND the licence
  // clock is exactly where it was — no fresh trial, no fresh year.
  const surviving = marker("2026-11-28", "2027-06-01", { expiry: "2027-11-28", unlocked: true });
  const s = computeTrialState(surviving, "2027-06-01");
  assertEq(s.status, "unlocked", "still licensed after reinstall-with-kept-data");
  assertEq(s.expiryDate, "2027-11-28", "licence end unchanged");
  assertEq(s.firstDate, "2026-11-28", "original first date, not the reinstall date");
  // And an expired trial stays expired after the same reinstall.
  const expired = computeTrialState(marker("2026-11-20", "2026-11-27"), "2026-11-30");
  assertEq(expired.status, "expired", "expired trial stays expired after reinstall");
  // The persisted marker after activation carries the licence forward.
  const m = markerForLaunch(s, "2027-06-01");
  assertEq(m.expiry, "2027-11-28", "marker keeps the licence expiry");
  assert(m.unlocked, "marker keeps the licence flag");
});

// ── scope guard: Tauri only ─────────────────────────────────────────────────
check("trial stays inert outside Tauri (VPS web app, ?demo=1, portfolio demos)", () => {
  const t = read("src/lib/trial.ts");
  assert(/if \(!isTauri\(\)\) return inactiveState\(\)/.test(t), "inactive outside Tauri");
  const server = read("server/index.js");
  assert(!/trial/i.test(server), "server has no trial code");
  const index = read("index.html");
  assert(!/trial/i.test(index), "?demo=1 page has no trial code");
});

console.log(`\n${ok}/${total} checks passed (${failed} failed)`);
if (failed > 0) process.exit(1);
