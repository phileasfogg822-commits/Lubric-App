/**
 * Batch 16 trial licensing — the trial clock, markers, reinstall and tamper
 * (Umar, 2026-11-28).
 *
 * Rules as built:
 *   - 7 days from FIRST LAUNCH (not install); login shows "Trial: N days left".
 *   - On expiry (or a turned-back clock) the whole app locks to one screen
 *     with a subscribe message + code box; data is NOT deleted by the lock.
 *   - The first date lives OUTSIDE the database (temp file, %PROGRAMDATA%,
 *     registry, log, WebView2 localStorage); the earliest first date wins,
 *     so reinstalling does NOT restart the clock.
 *   - Reinstall DOES wipe the business data: the NSIS uninstaller removes
 *     the app data dir (POSTUNINSTALL hook only — install/upgrade never
 *     runs it). The trial clock survives the reinstall.
 *   - The trial applies ONLY to the Windows Tauri build: every trial path
 *     is gated on isTauri(), so the VPS web app, ?demo=1 and the portfolio
 *     demo links never see it.
 *
 * The state machine is driven through the REAL trialCore (imported). The
 * accept path of applyCode is driven with a throwaway keypair via
 * applyCodeWithKey (the real private key is not in the repo, so no real
 * code can be forged in CI); the reject path goes through the real baked-in
 * key via applyCode. The wiring (App gate, login line, Rust markers, NSIS
 * hook) is checked against the real source files.
 *
 * Run:  node --experimental-strip-types server/sim_trial_licensing.js
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { generateKeyPairSync, sign } from "node:crypto";
import {
  CODE_TYPE_EXTEND,
  CODE_TYPE_UNLOCK,
  TRIAL_DAYS,
  applyCode,
  applyCodeWithKey,
  bytesToHex,
  codeMessage,
  computeTrialState,
  encodeCode,
  markerForLaunch,
  mergeMarkers,
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
  const nonce = new Uint8Array([7, 7, 7, 7]);
  const sig = sign(null, codeMessage(type, days, nonce), privateKey);
  return { code: encodeCode(type, days, nonce, sig), pubHex };
}

// ── the clock ───────────────────────────────────────────────────────────────
check("first launch starts a 7-day trial (daysLeft 7, expiry first+7)", () => {
  const s = computeTrialState(null, "2026-11-28");
  assertEq(s.status, "trial", "status");
  assertEq(s.firstDate, "2026-11-28", "first date");
  assertEq(s.expiryDate, "2026-12-05", "expiry");
  assertEq(s.daysLeft, 7, "days left on day one");
});

check("days-left counts down: day 3 -> 4, day 6 -> 1", () => {
  const m = marker("2026-11-28", "2026-11-28");
  assertEq(computeTrialState(m, "2026-12-01").daysLeft, 4, "day 3");
  assertEq(computeTrialState(m, "2026-12-04").daysLeft, 1, "day 6");
  assertEq(computeTrialState(m, "2026-12-04").status, "trial", "still trial on day 6");
});

check("day 7 expires the trial and locks the app", () => {
  const m = marker("2026-11-28", "2026-12-04");
  const s = computeTrialState(m, "2026-12-05");
  assertEq(s.status, "expired", "status on day 7");
  assertEq(s.daysLeft, 0, "days left");
});

// ── activation (accept path, throwaway key) ─────────────────────────────────
check("valid extend code adds 7 days on top of time still left", () => {
  const { code, pubHex } = mintTestCode(CODE_TYPE_EXTEND, 7);
  const s0 = computeTrialState(marker("2026-11-28", "2026-12-04"), "2026-12-04");
  const r = applyCodeWithKey(s0, code, "2026-12-04", pubHex);
  assert(r.ok, "must accept");
  assertEq(r.kind, "extend", "kind");
  assertEq(r.state.expiryDate, "2026-12-12", "expiry extends from the old expiry, not today");
  assertEq(r.state.daysLeft, 8, "days left after extend");
  assertEq(r.state.status, "trial", "back in trial");
});

check("extend after expiry counts from today, not the old expiry", () => {
  const { code, pubHex } = mintTestCode(CODE_TYPE_EXTEND, 7);
  const s0 = computeTrialState(marker("2026-11-28", "2026-12-04"), "2026-12-06");
  assertEq(s0.status, "expired", "expired first");
  const r = applyCodeWithKey(s0, code, "2026-12-06", pubHex);
  assert(r.ok, "must accept");
  assertEq(r.state.expiryDate, "2026-12-13", "expiry counts from today");
});

check("valid unlock code unlocks forever (still unlocked months later)", () => {
  const { code, pubHex } = mintTestCode(CODE_TYPE_UNLOCK, 0);
  const s0 = computeTrialState(marker("2026-11-28", "2026-12-04"), "2026-12-04");
  const r = applyCodeWithKey(s0, code, "2026-12-04", pubHex);
  assert(r.ok, "must accept");
  assertEq(r.kind, "unlock", "kind");
  assertEq(r.state.status, "unlocked", "unlocked");
  const later = computeTrialState(marker("2026-11-28", "2027-06-01", { unlocked: true, used: r.state.used }), "2027-06-01");
  assertEq(later.status, "unlocked", "still unlocked months later");
});

check("a used code is rejected the second time", () => {
  const { code, pubHex } = mintTestCode(CODE_TYPE_EXTEND, 7);
  const s0 = computeTrialState(marker("2026-11-28", "2026-12-04"), "2026-12-04");
  const r1 = applyCodeWithKey(s0, code, "2026-12-04", pubHex);
  assert(r1.ok, "first use ok");
  const r2 = applyCodeWithKey(r1.state, code, "2026-12-04", pubHex);
  assert(!r2.ok, "second use rejected");
  assert(/already been used/.test(r2.reason ?? ""), `reason: ${r2.reason}`);
});

check("an extend code cannot unlock, and an unlock code cannot extend", () => {
  const e = mintTestCode(CODE_TYPE_EXTEND, 7);
  const u = mintTestCode(CODE_TYPE_UNLOCK, 0);
  const s0 = computeTrialState(marker("2026-11-28", "2026-12-04"), "2026-12-04");
  const r1 = applyCodeWithKey(s0, e.code, "2026-12-04", e.pubHex);
  assertEq(r1.kind, "extend", "extend code extends");
  assert(!r1.state.unlocked, "extend does not unlock");
  const r2 = applyCodeWithKey(s0, u.code, "2026-12-04", u.pubHex);
  assertEq(r2.kind, "unlock", "unlock code unlocks");
  assertEq(r2.state.expiryDate, "2026-12-05", "unlock does not move the expiry");
});

// ── markers: earliest first wins, latest last-seen wins ────────────────────
check("merge takes the EARLIEST first date across stores", () => {
  const merged = mergeMarkers([
    marker("2026-11-28", "2026-11-28"),
    marker("2026-11-25", "2026-11-26"),
    marker(null, null),
  ]);
  assertEq(merged.first, "2026-11-25", "earliest first wins");
  assertEq(merged.lastSeen, "2026-11-28", "latest last-seen wins");
});

check("merge takes the longest expiry and any unlock, and unions used codes", () => {
  const merged = mergeMarkers([
    marker("2026-11-28", "2026-11-28", { expiry: "2026-12-05", used: ["aa"] }),
    marker("2026-11-28", "2026-11-28", { expiry: "2026-12-12", unlocked: true, used: ["bb"] }),
  ]);
  assertEq(merged.expiry, "2026-12-12", "longest expiry wins");
  assert(merged.unlocked, "any unlock wins");
  assertEq(merged.used.sort().join(","), "aa,bb", "used codes union");
});

check("markerForLaunch advances last-seen but never moves first", () => {
  const s = computeTrialState(marker("2026-11-28", "2026-11-28"), "2026-12-01");
  const m = markerForLaunch(s, "2026-12-01");
  assertEq(m.first, "2026-11-28", "first untouched");
  assertEq(m.lastSeen, "2026-12-01", "last-seen advanced");
});

// ── tamper: clock turned back ───────────────────────────────────────────────
check("today earlier than last-seen locks the app as tampered", () => {
  const s = computeTrialState(marker("2026-11-28", "2026-12-01"), "2026-11-30");
  assertEq(s.status, "tampered", "status");
  assert(s.tampered, "tampered flag");
});

check("today earlier than the first date also locks as tampered", () => {
  const s = computeTrialState(marker("2026-11-28", "2026-11-28"), "2026-11-20");
  assertEq(s.status, "tampered", "status");
});

check("a valid code clears a tamper lock (last-seen resets on activation)", () => {
  const { code, pubHex } = mintTestCode(CODE_TYPE_EXTEND, 7);
  const s0 = computeTrialState(marker("2026-11-28", "2026-12-01"), "2026-11-30");
  assertEq(s0.status, "tampered", "tampered first");
  const r = applyCodeWithKey(s0, code, "2026-11-30", pubHex);
  assert(r.ok, "activation accepted");
  assertEq(r.state.status, "trial", "tamper cleared");
  // The persisted marker carries lastSeen = today, so the next launch —
  // with the merged marker — is NOT tampered again.
  const m = markerForLaunch(r.state, "2026-11-30");
  const next = computeTrialState(m, "2026-11-30");
  assertEq(next.status, "trial", "next launch clean");
});

// ── reinstall: clock survives, data does not ────────────────────────────────
check("reinstall with surviving markers resumes the ORIGINAL clock (no fresh trial)", () => {
  // Trial started 2026-11-20, expired 2026-11-27. The user uninstalls and
  // reinstalls on 2026-11-30: the database is gone, but the markers in
  // temp / ProgramData / registry / log survive.
  const surviving = marker("2026-11-20", "2026-11-27");
  const s = computeTrialState(surviving, "2026-11-30");
  assertEq(s.status, "expired", "still expired after reinstall");
  assertEq(s.firstDate, "2026-11-20", "original first date, not the reinstall date");
  assertEq(s.daysLeft, 0, "no fresh days");
});

check("reinstall wipes the business data: NSIS POSTUNINSTALL removes the app data dirs", () => {
  const conf = read("src-tauri/tauri.conf.json");
  assert(/"installerHooks"\s*:\s*"nsis-hooks\.nsh"/.test(conf), "tauri.conf wires installerHooks");
  const hooks = read("src-tauri/nsis-hooks.nsh");
  assert(/!macro NSIS_HOOK_POSTUNINSTALL/.test(hooks), "POSTUNINSTALL hook present");
  assert(/RMDir \/r "\$APPDATA\\app\.lubric\.desktop"/.test(hooks), "roaming app data removed");
  assert(/RMDir \/r "\$LOCALAPPDATA\\app\.lubric\.desktop"/.test(hooks), "local app data removed");
  assert(!/!macro NSIS_HOOK_(PRE|POST)INSTALL/.test(hooks), "no install-time hook — upgrade never wipes");
  const db = read("src/lib/db.ts");
  assert(/load\("sqlite:lubric\.db"\)/.test(db), "database is the relative lubric.db (app data dir)");
});

check("trial markers live OUTSIDE the app data dir (Rust)", () => {
  const rs = read("src-tauri/src/trial_markers.rs");
  assert(/lubric\.app-trial\.json/.test(rs), "temp marker file");
  assert(/PROGRAMDATA/.test(rs), "ProgramData marker");
  assert(/HKCU\\Software\\lubric\.app/.test(rs), "registry key");
  assert(/trial\.log/.test(rs), "log file");
  assert(!/app\.lubric\.desktop/.test(rs), "markers never touch the wiped app data dir");
});

check("Rust trial commands are registered and capability-granted", () => {
  const lib = read("src-tauri/src/lib.rs");
  assert(/trial_markers::trial_markers_read/.test(lib), "read command registered");
  assert(/trial_markers::trial_markers_write/.test(lib), "write command registered");
  const caps = read("src-tauri/capabilities/default.json");
  assert(/"allow-trial-markers"/.test(caps), "capability lists allow-trial-markers");
  const perm = read("src-tauri/permissions/trial-markers.toml");
  assert(/trial_markers_read/.test(perm) && /trial_markers_write/.test(perm), "permission allows both commands");
});

// ── the gate: Tauri only ────────────────────────────────────────────────────
check("trial is inert outside Tauri: trial.ts returns inactive without isTauri()", () => {
  const t = read("src/lib/trial.ts");
  assert(/if \(!isTauri\(\)\) return inactiveState\(\)/.test(t), "inactive outside Tauri");
  assert(/import \{ isTauri \} from "\.\/db"/.test(t), "gated on the shared isTauri()");
});

check("App gate locks the whole app on expired/tampered, passes everything else", () => {
  const app = read("src/App.tsx");
  assert(/TrialGate/.test(app), "TrialGate exists");
  assert(/trial\.status === "expired" \|\| trial\.status === "tampered"/.test(app), "locks on expired/tampered");
  assert(/<TrialLock/.test(app), "lock screen rendered");
  assert(/<TrialGate>\s*<Routes>/.test(app), "gate wraps every route");
});

check("login shows days-left only in trial, licensed only when unlocked", () => {
  const login = read("src/modules/auth/Login.tsx");
  assert(/trial\.status === "trial"/.test(login), "trial line gated on trial status");
  assert(/Trial: \{trial\.daysLeft\} day/.test(login), "days-left line");
  assert(/trial\.status === "unlocked"/.test(login), "licensed line gated on unlocked");
});

check("VPS web app, demo auto-login and server have no trial references", () => {
  const server = read("server/index.js");
  assert(!/trial/i.test(server), "server has no trial code");
  const index = read("index.html");
  assert(!/trial/i.test(index), "?demo=1 page has no trial code");
  const core = read("src/lib/trialCore.ts");
  assert(!/demo/i.test(core), "trial core never mentions demo");
});

check("trial never deletes data: no DELETE/DROP in the trial modules", () => {
  for (const p of ["src/lib/trial.ts", "src/lib/trialCore.ts", "src-tauri/src/trial_markers.rs"]) {
    const src = read(p);
    assert(!/\bDROP\b|\bDELETE FROM\b/i.test(src), `${p} must not delete data`);
  }
});

console.log(`\n${ok}/${total} checks passed (${failed} failed)`);
if (failed > 0) process.exit(1);
