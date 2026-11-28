# Announcements — messages for the Windows app (batch 17)

## Where the live file is

`/opt/apps/app9/updates/announcements.json` on the VPS — the same
directory that already holds `android.json` (it is mounted read-only into
the API container at `/app/updates`). The Windows app reads it through
`GET /api/announcements` (public, no login). Edit that one file and the
change is live immediately: no rebuild, no restart, no deploy.

The file `server/updates/announcements.json` in this repo is only the
seed / example. At deploy time, copy it to
`/opt/apps/app9/updates/announcements.json` **only if the live file does
not exist yet** — never overwrite it, or Umar's messages would be wiped
by the next deploy.

## Format

```json
{
  "messages": [
    {
      "id": "offer-eid-2026",
      "title": "Eid offer — 10% off annual licence",
      "text": "Renew your lubric.app licence before 30 June and get 10% off. Contact grafixers.co.uk to renew.",
      "expires": "2026-06-30"
    },
    {
      "id": "new-version-note",
      "title": "New in this version",
      "text": "The Purchases screen now shows the stock-in log for every invoice."
    }
  ]
}
```

- `id` — required, unique. Change the id and the message shows again
  on every install (each message shows once per install).
- `title` — required, short headline shown bold in the banner.
- `text` — required, one or two sentences.
- `expires` — optional, `YYYY-MM-DD`. The message shows through that
  date and never after. Leave it out and the message shows until it is
  dismissed on each install (once seen, it never shows again).
- A message with a missing/empty id, title or text, or a bad expiry
  date, is skipped silently. A missing or broken file means "no news" —
  the app carries on exactly as before.

## How the app uses it

- Windows (Tauri) installs only. The VPS web app, `?demo=1` and the
  portfolio demos never fetch the feed and never show the banner.
- The app fetches at most once a day, with a 5-second timeout, and
  sends no customer data and no install identity — a plain GET.
- Offline, or the server unreachable, or the file broken: nothing
  happens. The app never blocks and never shows an error.
