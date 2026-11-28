/**
 * Batch 16 (2026-11-28): trial licensing — Tauri integration.
 *
 * The trial applies ONLY to the Windows standalone (Tauri) build. Every
 * function here is inert outside Tauri: `loadTrialState` returns
 * status "inactive" and the app behaves exactly as before, so the VPS web
 * app, the ?demo=1 auto-login and the portfolio demo links are untouched,
 * and the unit/sims suites (Node, no Tauri) never see the gate.
 *
 * Where the first-launch date lives (all outside the app's own database,
 * so wiping the database or reinstalling does NOT restart the clock):
 *   - WebView2 localStorage (`lubric_trial_marker`)
 *   - %TEMP%\lubric.app-trial.json            (Rust)
 *   - %PROGRAMDATA%\lubric.app\trial.json     (Rust)
 *   - HKCU\Software\lubric.app registry values (Rust, via `reg`)
 *   - %PROGRAMDATA%\lubric.app\trial.log + %TEMP%\lubric-trial.log (Rust)
 * The earliest first date ever seen wins (trialCore.mergeMarkers). The
 * last-seen date is kept in the same places: if today is earlier than the
 * last-seen date the clock was turned back and the app locks as tampered.
 *
 * Business data is never deleted by the trial: the lock screen only hides
 * the app until a valid code is entered. The reinstall wipe is the
 * INSTALLER's job (NSIS_HOOK_POSTUNINSTALL in src-tauri/nsis-hooks.nsh
 * removes the app data dir on uninstall) — this module only carries the
 * clock, which deliberately survives the reinstall.
 */

import { isTauri } from "./db";
import {
  TrialMarker,
  TrialState,
  applyCode,
  computeTrialState,
  emptyMarker,
  markerForLaunch,
  mergeMarkers,
  todayString,
} from "./trialCore";

const LS_KEY = "lubric_trial_marker";

export interface RustMarkers {
  temp: TrialMarker | null;
  programData: TrialMarker | null;
  registry: TrialMarker | null;
  log: TrialMarker | null;
}

function readLocalMarker(): TrialMarker | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const m = JSON.parse(raw) as Partial<TrialMarker>;
    return {
      first: typeof m.first === "string" ? m.first : null,
      lastSeen: typeof m.lastSeen === "string" ? m.lastSeen : null,
      expiry: typeof m.expiry === "string" ? m.expiry : null,
      unlocked: m.unlocked === true,
      used: Array.isArray(m.used) ? m.used.filter((x): x is string => typeof x === "string") : [],
    };
  } catch {
    return null;
  }
}

function writeLocalMarker(m: TrialMarker): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(m));
  } catch {
    /* private mode — the Rust markers still carry the clock */
  }
}

async function readRustMarkers(): Promise<TrialMarker[]> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const res = (await invoke("trial_markers_read")) as RustMarkers;
    return [res.temp, res.programData, res.registry, res.log].filter(
      (m): m is TrialMarker => m !== null
    );
  } catch (e) {
    // Rust side missing (capability / older build): the localStorage marker
    // still carries the clock for this install. Loud in the console, never
    // a bricked till.
    console.error("[lubric] trial markers read failed — using localStorage only:", e);
    return [];
  }
}

async function writeRustMarkers(m: TrialMarker): Promise<void> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("trial_markers_write", { marker: m });
  } catch (e) {
    console.error("[lubric] trial markers write failed — localStorage still saved:", e);
  }
}

function inactiveState(): TrialState {
  return {
    status: "inactive",
    firstDate: null,
    expiryDate: null,
    daysLeft: 0,
    tampered: false,
    unlocked: false,
    used: [],
    lastSeen: null,
  };
}

// One load per app run: the trial clock is read once at startup and the
// result is shared by the gate (App.tsx) and the login screen.
let cachedPromise: Promise<TrialState> | null = null;
let cachedState: TrialState | null = null;

export function getCachedTrialState(): TrialState | null {
  return cachedState;
}

export function loadTrialState(): Promise<TrialState> {
  if (cachedPromise) return cachedPromise;
  cachedPromise = (async (): Promise<TrialState> => {
    if (!isTauri()) return inactiveState();
    const today = todayString();
    const markers: TrialMarker[] = [];
    const local = readLocalMarker();
    if (local) markers.push(local);
    markers.push(...(await readRustMarkers()));
    const merged = mergeMarkers(markers);
    const state = computeTrialState(merged.first ? merged : null, today);
    // Persist the launch: a first launch records its date everywhere, and
    // every launch advances last-seen. The write is a full merged marker,
    // so a stale future last-seen in any one store is overwritten — that
    // is what lets a legitimate activation clear a tamper lock.
    const toSave = markerForLaunch(state, today);
    const changed =
      merged.first !== toSave.first ||
      merged.lastSeen !== toSave.lastSeen ||
      merged.expiry !== toSave.expiry ||
      merged.unlocked !== toSave.unlocked ||
      JSON.stringify([...merged.used].sort()) !== JSON.stringify([...toSave.used].sort());
    if (changed) {
      writeLocalMarker(toSave);
      await writeRustMarkers(toSave);
    }
    cachedState = state;
    return state;
  })();
  cachedPromise.then((s) => {
    cachedState = s;
  });
  return cachedPromise;
}

/** Reload after an activation, so the gate re-evaluates. */
export function refreshTrialState(): Promise<TrialState> {
  cachedPromise = null;
  cachedState = null;
  return loadTrialState();
}

export interface ActivationOutcome {
  ok: boolean;
  reason?: string;
  kind?: "extend" | "unlock";
  daysAdded?: number;
  state?: TrialState;
}

/**
 * Enter an activation code on the lock screen. Verifies offline against
 * the baked-in public key, rejects reuse and foreign codes, and persists
 * the new state to every marker store before reporting success.
 */
export async function activateTrialCode(input: string): Promise<ActivationOutcome> {
  const state = await loadTrialState();
  if (state.status === "inactive") {
    return { ok: false, reason: "trial does not apply to this build" };
  }
  const today = todayString();
  const result = applyCode(state, input, today);
  if (!result.ok || !result.state) {
    return { ok: false, reason: result.reason ?? "invalid code" };
  }
  const toSave = markerForLaunch(result.state, today);
  writeLocalMarker(toSave);
  await writeRustMarkers(toSave);
  cachedState = result.state;
  return {
    ok: true,
    kind: result.kind,
    daysAdded: result.daysAdded,
    state: result.state,
  };
}

/** Re-exported for the lock screen's "trial started …" line. */
export { emptyMarker };
