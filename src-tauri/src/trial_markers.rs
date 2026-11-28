//! Batch 16 (2026-11-28): trial-clock markers outside the app database.
//!
//! The 7-day trial starts at FIRST LAUNCH, and the date must survive a
//! database wipe and a reinstall — otherwise uninstalling and reinstalling
//! would mint a fresh trial forever. So the clock lives in four places the
//! app's own data dir never touches:
//!
//!   - %TEMP%\lubric.app-trial.json
//!   - %PROGRAMDATA%\lubric.app\trial.json (+ trial.log, same dir)
//!   - HKCU\Software\lubric.app (registry, via the `reg` CLI — no new crate)
//!   - %TEMP%\lubric-trial.log (a second copy of the log)
//!
//! The frontend (src/lib/trial.ts) merges all four plus its WebView2
//! localStorage marker and takes the EARLIEST first date — that is what
//! stops a reinstall from restarting the clock — and the LATEST last-seen
//! date, which is what catches a turned-back clock.
//!
//! Everything here is best-effort: a store that cannot be read is treated
//! as absent, a store that cannot be written is logged to stderr and the
//! others still carry the clock. A failed marker write never bricks the
//! till. The uninstall wipe of the BUSINESS data is not here — it is the
//! NSIS_HOOK_POSTUNINSTALL hook (src-tauri/nsis-hooks.nsh), which removes
//! the app data dir when the user uninstalls.

use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::PathBuf;

/// One stored first-launch record. Field names are camelCase on the wire
/// so the frontend's TrialMarker shape matches exactly.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct TrialMarkerJson {
    pub first: Option<String>,
    pub last_seen: Option<String>,
    pub expiry: Option<String>,
    pub unlocked: bool,
    pub used: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrialMarkersRead {
    pub temp: Option<TrialMarkerJson>,
    pub program_data: Option<TrialMarkerJson>,
    pub registry: Option<TrialMarkerJson>,
    pub log: Option<TrialMarkerJson>,
}

fn temp_marker_path() -> PathBuf {
    std::env::temp_dir().join("lubric.app-trial.json")
}

fn temp_log_path() -> PathBuf {
    std::env::temp_dir().join("lubric-trial.log")
}

fn program_data_dir() -> PathBuf {
    match std::env::var("PROGRAMDATA") {
        Ok(v) if !v.is_empty() => PathBuf::from(v).join("lubric.app"),
        _ => std::env::temp_dir().join("lubric.app"),
    }
}

fn read_marker_file(path: &PathBuf) -> Option<TrialMarkerJson> {
    let text = fs::read_to_string(path).ok()?;
    serde_json::from_str(&text).ok()
}

fn write_marker_file(path: &PathBuf, marker: &TrialMarkerJson) {
    if let Some(parent) = path.parent() {
        if fs::create_dir_all(parent).is_err() {
            return;
        }
    }
    if let Ok(text) = serde_json::to_string(marker) {
        if fs::write(path, text).is_err() {
            eprintln!("[lubric] trial marker write failed: {}", path.display());
        }
    }
}

fn min_date(a: &Option<String>, b: &Option<String>) -> Option<String> {
    match (a, b) {
        (Some(x), Some(y)) => Some(if x < y { x.clone() } else { y.clone() }),
        (Some(x), None) => Some(x.clone()),
        (None, Some(y)) => Some(y.clone()),
        (None, None) => None,
    }
}

fn max_date(a: &Option<String>, b: &Option<String>) -> Option<String> {
    match (a, b) {
        (Some(x), Some(y)) => Some(if x > y { x.clone() } else { y.clone() }),
        (Some(x), None) => Some(x.clone()),
        (None, Some(y)) => Some(y.clone()),
        (None, None) => None,
    }
}

fn merge_into(acc: &mut TrialMarkerJson, m: &TrialMarkerJson) {
    acc.first = min_date(&acc.first, &m.first);
    acc.last_seen = max_date(&acc.last_seen, &m.last_seen);
    acc.expiry = max_date(&acc.expiry, &m.expiry);
    if m.unlocked {
        acc.unlocked = true;
    }
    for h in &m.used {
        if !acc.used.contains(h) {
            acc.used.push(h.clone());
        }
    }
}

/// Append one JSON line to a trial log. The log is itself a marker source:
/// every line carries the first date, so the earliest line wins even if
/// every other store was deleted.
fn append_log(path: &PathBuf, marker: &TrialMarkerJson) {
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let line = serde_json::json!({
        "ts": chrono_ts(),
        "event": "persist",
        "first": marker.first,
        "lastSeen": marker.last_seen,
        "expiry": marker.expiry,
        "unlocked": marker.unlocked,
        "used": marker.used,
    });
    if let Ok(mut f) = fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(f, "{}", line.to_string());
    }
}

/// Seconds since the Unix epoch, as a string — enough for a log line; the
/// trial itself counts whole UTC calendar days, never wall-clock seconds.
fn chrono_ts() -> String {
    match std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH) {
        Ok(d) => d.as_secs().to_string(),
        Err(_) => "0".to_string(),
    }
}

fn read_log_marker(paths: &[PathBuf]) -> Option<TrialMarkerJson> {
    let mut acc = TrialMarkerJson::default();
    let mut any = false;
    for path in paths {
        let text = match fs::read_to_string(path) {
            Ok(t) => t,
            Err(_) => continue,
        };
        for line in text.lines() {
            let v: serde_json::Value = match serde_json::from_str(line) {
                Ok(v) => v,
                Err(_) => continue, // a torn last line (crash mid-write) is skipped
            };
            let mut m = TrialMarkerJson::default();
            m.first = v.get("first").and_then(|x| x.as_str()).map(|s| s.to_string());
            m.last_seen = v
                .get("lastSeen")
                .and_then(|x| x.as_str())
                .map(|s| s.to_string());
            m.expiry = v.get("expiry").and_then(|x| x.as_str()).map(|s| s.to_string());
            m.unlocked = v.get("unlocked").and_then(|x| x.as_bool()).unwrap_or(false);
            if let Some(arr) = v.get("used").and_then(|x| x.as_array()) {
                for item in arr {
                    if let Some(s) = item.as_str() {
                        m.used.push(s.to_string());
                    }
                }
            }
            if m.first.is_some() || m.last_seen.is_some() {
                any = true;
            }
            merge_into(&mut acc, &m);
        }
    }
    if any {
        Some(acc)
    } else {
        None
    }
}

#[cfg(windows)]
fn reg_query() -> Option<TrialMarkerJson> {
    let out = std::process::Command::new("reg")
        .args(["query", r"HKCU\Software\lubric.app"])
        .output()
        .ok()?;
    if !out.status.success() {
        return None; // key does not exist yet — a genuine first launch
    }
    let text = String::from_utf8_lossy(&out.stdout);
    let mut m = TrialMarkerJson::default();
    let mut found = false;
    for line in text.lines() {
        let t = line.trim();
        if t.is_empty() || t.starts_with("HKEY_") {
            continue;
        }
        // Columns are `Name    REG_SZ    value`, separated by runs of spaces.
        let parts: Vec<&str> = t.split_whitespace().collect();
        if parts.len() < 3 {
            continue;
        }
        let value = parts[2..].join(" ");
        match parts[0] {
            "FirstDate" => {
                m.first = Some(value);
                found = true;
            }
            "LastSeen" => {
                m.last_seen = Some(value);
                found = true;
            }
            "Expiry" => {
                m.expiry = Some(value);
                found = true;
            }
            "Unlocked" => {
                m.unlocked = value == "1";
                found = true;
            }
            "UsedCodes" => {
                m.used = value
                    .split(',')
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
                    .collect();
                found = true;
            }
            _ => {}
        }
    }
    if found {
        Some(m)
    } else {
        None
    }
}

#[cfg(not(windows))]
fn reg_query() -> Option<TrialMarkerJson> {
    None
}

#[cfg(windows)]
fn reg_write(m: &TrialMarkerJson) {
    let key = r"HKCU\Software\lubric.app";
    let set = |name: &str, value: &str| {
        let r = std::process::Command::new("reg")
            .args(["add", key, "/v", name, "/t", "REG_SZ", "/d", value, "/f"])
            .output();
        if let Err(e) = r {
            eprintln!("[lubric] trial registry write failed ({name}): {e}");
        }
    };
    let del = |name: &str| {
        let _ = std::process::Command::new("reg")
            .args(["delete", key, "/v", name, "/f"])
            .output();
    };
    if let Some(v) = &m.first {
        set("FirstDate", v);
    }
    if let Some(v) = &m.last_seen {
        set("LastSeen", v);
    }
    match &m.expiry {
        Some(v) => set("Expiry", v),
        None => del("Expiry"),
    }
    set("Unlocked", if m.unlocked { "1" } else { "0" });
    set("UsedCodes", &m.used.join(","));
}

#[cfg(not(windows))]
fn reg_write(m: &TrialMarkerJson) {
    let _ = m;
}

/// Read every marker store. Never fails: an unreadable store is null.
#[tauri::command]
pub fn trial_markers_read() -> Result<TrialMarkersRead, String> {
    let program_data_file = program_data_dir().join("trial.json");
    Ok(TrialMarkersRead {
        temp: read_marker_file(&temp_marker_path()),
        program_data: read_marker_file(&program_data_file),
        registry: reg_query(),
        log: read_log_marker(&[program_data_dir().join("trial.log"), temp_log_path()]),
    })
}

/// Write the merged marker to every store, and append a log line carrying
/// the first date. Best-effort throughout; always Ok.
#[tauri::command]
pub fn trial_markers_write(marker: TrialMarkerJson) -> Result<(), String> {
    write_marker_file(&temp_marker_path(), &marker);
    write_marker_file(&program_data_dir().join("trial.json"), &marker);
    reg_write(&marker);
    append_log(&program_data_dir().join("trial.log"), &marker);
    append_log(&temp_log_path(), &marker);
    Ok(())
}
