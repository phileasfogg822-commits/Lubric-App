; Batch 16 (2026-11-28): trial licensing — uninstall must wipe the BUSINESS
; data, so a reinstall starts with a fresh empty shop. An upgrade (installing
; a newer version over the old one) does NOT run the uninstaller, so it keeps
; the data — only uninstall wipes it.
;
; Why this hook, and why only here: the local database (sqlite:lubric.db,
; loaded by src/lib/db.ts) lives in the app data dir, and Tauri's default
; NSIS uninstaller removes the program files but leaves the app data dir
; behind — a reinstall would otherwise find the old customers, sales and
; stock. The trial clock is deliberately NOT wiped here: it lives in
; %TEMP%, %PROGRAMDATA%, HKCU\Software\lubric.app and the log (see
; src-tauri/src/trial_markers.rs), so a reinstalled app still locks when
; the original trial already expired — with empty data.
;
; Paths removed:
;   %APPDATA%\app.lubric.desktop      — the database (plugin-sql appDataDir)
;   %LOCALAPPDATA%\app.lubric.desktop — WebView2 data (localStorage marker)
; $APPDATA / $LOCALAPPDATA are the current user's dirs, matching this
; installer's installMode "currentUser". RMDir /r on a missing dir is a
; no-op, so a partial install uninstalls cleanly too.

!macro NSIS_HOOK_POSTUNINSTALL
  RMDir /r "$APPDATA\app.lubric.desktop"
  RMDir /r "$LOCALAPPDATA\app.lubric.desktop"
!macroend
