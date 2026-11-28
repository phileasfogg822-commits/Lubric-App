; Batch 16 (2026-11-28): trial licensing — uninstall must wipe the BUSINESS
; data, so a reinstall starts with a fresh empty shop. An upgrade (installing
; a newer version over the old one) does NOT run the uninstaller, so it keeps
; the data — only uninstall wipes it.
;
; Batch 16.1 (2026-11-28): the wipe is no longer unconditional — the
; uninstaller asks once, with a Yes/No question, whether to KEEP the shop
; data. Why a question and not a checkbox on the uninstall page: Tauri's
; NSIS template only lets a hooks file add the four PRE/POST
; INSTALL/UNINSTALL macros — there is no hook to add a page or a control
; to the stock uninstall page. A real checkbox would need a fork of
; Tauri's whole installer.nsi template (bundle.windows.nsis.template),
; which would have to be re-checked against every Tauri upgrade. The
; question below is the smallest equivalent inside the supported hooks:
; one click, asked before anything is removed, wipe stays the default.
;
;   "Keep my shop data (customers, sales and stock) on this PC?"
;     Yes -> the data dir is left in place, so the next install opens the
;            SAME shop, accounts, sales and stock.
;     No  -> the data dir is deleted, so the next install starts empty.
;   A silent uninstall (Uninstall.exe /S) never prompts and keeps the
;   wipe default. Install/upgrade never runs either hook, so installing
;   a newer version over the old one always keeps the data.
;
; The trial clock is deliberately NOT wiped here either way: it lives in
; %TEMP%, %PROGRAMDATA%, HKCU\Software\lubric.app and the log (see
; src-tauri/src/trial_markers.rs), so keeping the data does NOT reset the
; trial clock — a reinstalled app still locks when the original trial
; (or licence) already expired.
;
; Paths removed (only when the user did NOT ask to keep the data):
;   %APPDATA%\app.lubric.desktop      — the database (plugin-sql appDataDir)
;   %LOCALAPPDATA%\app.lubric.desktop — WebView2 data (localStorage marker)
; $APPDATA / $LOCALAPPDATA are the current user's dirs, matching this
; installer's installMode "currentUser". RMDir /r on a missing dir is a
; no-op, so a partial install uninstalls cleanly too.

Var KEEP_DATA

!macro NSIS_HOOK_PREUNINSTALL
  ; Default: wipe (Umar's original rule). Ask once, before anything is
  ; removed; a silent uninstall never prompts and keeps the default.
  StrCpy $KEEP_DATA "0"
  IfSilent lubric_keepdata_done
  MessageBox MB_YESNO|MB_ICONQUESTION "Keep my shop data (customers, sales and stock) on this PC?$\n$\nYes = keep the data, so the next install opens the same shop.$\nNo = delete everything, so the next install starts with an empty shop." IDYES lubric_keepdata_yes
  Goto lubric_keepdata_done
  lubric_keepdata_yes:
  StrCpy $KEEP_DATA "1"
  lubric_keepdata_done:
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; Only wipe when the user did not ask to keep the data. Plain StrCmp
  ; (no LogicLib dependency — the stock template does not guarantee it).
  StrCmp $KEEP_DATA "1" lubric_keepdata_skip
  RMDir /r "$APPDATA\app.lubric.desktop"
  RMDir /r "$LOCALAPPDATA\app.lubric.desktop"
  lubric_keepdata_skip:
!macroend
