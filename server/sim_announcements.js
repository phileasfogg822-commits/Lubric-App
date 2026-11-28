/**
 * Batch 17 (2026-11-28): in-app announcements.
 *
 * Rules as built:
 *   - The feed is `{ "messages": [{ id, title, text, expires? }] }` served
 *     by GET /api/announcements (public, no auth) from
 *     <updates-dir>/announcements.json. Missing file, malformed JSON, or a
 *     wrong shape yields { messages: [] } — never an error.
 *   - The app (Tauri only) fetches at most once a day with a 5-second
 *     timeout, sending NO identity: plain GET, credentials 'omit', no auth
 *     headers. Offline/unreachable/malformed = silent no-op.
 *   - Each message shows once per install (seen ids in localStorage);
 *     expired messages (expiry day itself still shows) never show.
 *   - The VPS web app, ?demo=1 and portfolio demos never fetch the feed
 *     and never show the banner (isTauri gate, in the client AND in Layout).
 *
 * The pure feed logic is driven through the REAL src/lib/announcements.ts
 * (imported); the server loader through the REAL server/announcements.js
 * with temp dirs; the wiring (gates, no-identity fetch, banner mount) is
 * checked against the real source files.
 *
 * Run:  node --experimental-strip-types server/sim_announcements.js
 */

import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ANNOUNCEMENTS_URL,
  isExpired,
  parseAnnouncementsFeed,
  pickAnnouncement,
  todayStringLocal,
} from "../src/lib/announcements.ts";
import { loadAnnouncements } from "../server/announcements.js";

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

// ── pure feed parsing ───────────────────────────────────────────────────
check("parse: valid {messages:[...]} keeps every good entry", () => {
  const out = parseAnnouncementsFeed({ messages: [
    { id: "a", title: "T", text: "x" },
    { id: "b", title: "T", text: "x", expires: "2026-12-31" },
  ]});
  assertEq(out.length, 2, "entry count");
  assertEq(out[1].expires, "2026-12-31", "expiry kept");
  assertEq(out[0].expires, null, "missing expiry is null");
});
check("parse: bare array accepted", () => {
  assertEq(parseAnnouncementsFeed([{ id: "a", title: "T", text: "x" }]).length, 1, "bare array");
});
check("parse: malformed shapes yield []", () => {
  for (const bad of [null, undefined, "nope", 42, {}, { messages: "nope" }, { messages: [null] }]) {
    assertEq(parseAnnouncementsFeed(bad).length, 0, `shape ${JSON.stringify(bad)}`);
  }
});
check("parse: entries missing id/title/text are dropped", () => {
  const out = parseAnnouncementsFeed({ messages: [
    { title: "T", text: "x" },
    { id: "a", text: "x" },
    { id: "a", title: "T" },
    { id: "  ", title: "T", text: "x" },
    { id: "ok", title: "T", text: "x" },
  ]});
  assertEq(out.length, 1, "only the good entry survives");
  assertEq(out[0].id, "ok", "survivor id");
});
check("parse: bad expiry date drops the entry, duplicate id keeps the first", () => {
  const out = parseAnnouncementsFeed({ messages: [
    { id: "bad", title: "T", text: "x", expires: "31-12-2026" },
    { id: "dup", title: "First", text: "x" },
    { id: "dup", title: "Second", text: "y" },
  ]});
  assertEq(out.length, 1, "one survivor");
  assertEq(out[0].title, "First", "first duplicate wins");
});
check("parse: fields are trimmed", () => {
  const out = parseAnnouncementsFeed({ messages: [{ id: " a ", title: " T ", text: " x " }] });
  assertEq(out[0].id, "a", "id trimmed");
});

// ── expiry + pick ───────────────────────────────────────────────────────
check("isExpired: past date expired, expiry day itself still shows", () => {
  assert(isExpired({ id: "a", title: "T", text: "x", expires: "2026-11-27" }, "2026-11-28"), "yesterday expired");
  assert(!isExpired({ id: "a", title: "T", text: "x", expires: "2026-11-28" }, "2026-11-28"), "expiry day shows");
  assert(!isExpired({ id: "a", title: "T", text: "x", expires: "2026-11-29" }, "2026-11-28"), "tomorrow shows");
  assert(!isExpired({ id: "a", title: "T", text: "x", expires: null }, "2026-11-28"), "no expiry never expires");
});
check("pick: first unexpired unseen in file order", () => {
  const msgs = [
    { id: "seen", title: "T", text: "x", expires: null },
    { id: "gone", title: "T", text: "x", expires: "2026-01-01" },
    { id: "new", title: "T", text: "x", expires: null },
  ];
  const picked = pickAnnouncement(msgs, ["seen"], "2026-11-28");
  assert(picked !== null && picked.id === "new", `picked ${picked && picked.id}`);
});
check("pick: null when everything is seen or expired", () => {
  const msgs = [{ id: "a", title: "T", text: "x", expires: "2026-01-01" }];
  assertEq(pickAnnouncement(msgs, [], "2026-11-28"), null, "expired only");
  assertEq(pickAnnouncement([{ id: "b", title: "T", text: "x", expires: null }], ["b"], "2026-11-28"), null, "seen only");
  assertEq(pickAnnouncement([], [], "2026-11-28"), null, "empty feed");
});
check("todayStringLocal is a YYYY-MM-DD date", () => {
  assert(/^\d{4}-\d{2}-\d{2}$/.test(todayStringLocal()), `got ${todayStringLocal()}`);
});

// ── server loader (real module, temp dirs) ──────────────────────────────
function withTmpDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), "lubric-ann-"));
  try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}
check("server: missing file yields { messages: [] }", () => {
  withTmpDir((dir) => {
    assertEq(loadAnnouncements(dir).messages.length, 0, "missing file");
  });
});
check("server: malformed JSON yields { messages: [] }", () => {
  withTmpDir((dir) => {
    writeFileSync(join(dir, "announcements.json"), "{not json", "utf8");
    assertEq(loadAnnouncements(dir).messages.length, 0, "malformed JSON");
  });
});
check("server: valid file returns its messages, bad entries dropped", () => {
  withTmpDir((dir) => {
    writeFileSync(join(dir, "announcements.json"), JSON.stringify({ messages: [
      { id: "a", title: "T", text: "x" },
      { id: "", title: "T", text: "x" },
    ]}), "utf8");
    const out = loadAnnouncements(dir);
    assertEq(out.messages.length, 1, "one good message");
    assertEq(out.messages[0].id, "a", "message id");
  });
});
check("server: non-array messages yields { messages: [] }", () => {
  withTmpDir((dir) => {
    writeFileSync(join(dir, "announcements.json"), JSON.stringify({ messages: "nope" }), "utf8");
    assertEq(loadAnnouncements(dir).messages.length, 0, "non-array messages");
  });
});

// ── wiring: endpoint, no-identity fetch, Tauri gate, banner mount ──────
check("server: GET /api/announcements is public and reads the updates dir", () => {
  const src = read("server/index.js");
  assert(src.includes("app.get('/api/announcements'"), "route missing");
  assert(src.includes("loadAnnouncements(UPDATES_DIR)"), "route does not read UPDATES_DIR");
  assert(src.includes("Cache-Control', 'no-store'"), "feed must not be cached");
  const routeAt = src.indexOf("app.get('/api/announcements'");
  const guardNear = src.slice(Math.max(0, routeAt - 400), routeAt);
  assert(!guardNear.includes("requirePermission"), "announcements route must not be permission-guarded");
});
check("client: fetch is a plain GET with no identity and a 5s timeout", () => {
  const src = read("src/lib/announcementsClient.ts");
  assert(src.includes("credentials: \"omit\""), "fetch must send no credentials");
  assert(!src.includes("authHeaders"), "feed fetch must never attach auth headers");
  assert(!src.includes("lubric_token"), "feed fetch must never read the login token");
  assert(src.includes("FETCH_TIMEOUT_MS = 5000"), "feed fetch needs a 5s timeout");
  assert(src.includes("if (!isTauri()) return []"), "feed fetch must be Tauri-gated");
  assert(src.includes("LAST_FETCH_KEY"), "feed must be fetched at most once a day");
});
check("client: feed URL is the VPS :9001 front door", () => {
  assertEq(ANNOUNCEMENTS_URL, "http://72.61.115.120:9001/api/announcements", "feed URL");
});
check("Layout mounts the banner only under Tauri", () => {
  const layout = read("src/components/Layout.tsx");
  assert(layout.includes("<AnnouncementsBanner />"), "banner not mounted in Layout");
  assert(layout.includes("{isTauri() ? ("), "banner mount is not Tauri-gated");
  const banner = read("src/components/AnnouncementsBanner.tsx");
  assert(banner.includes("markAnnouncementSeen(current.id)"), "dismiss must record the id as seen");
  assert(banner.includes("if (!isTauri()) return;"), "banner must no-op outside Tauri");
});
check("repo ships an empty seed feed + docs", () => {
  const seed = JSON.parse(read("server/updates/announcements.json"));
  assert(Array.isArray(seed.messages) && seed.messages.length === 0, "seed feed must be empty");
  const docs = read("server/updates/ANNOUNCEMENTS.md");
  assert(docs.includes("/opt/apps/app9/updates/announcements.json"), "docs must name the live file");
  assert(docs.includes("never overwrite"), "docs must warn against overwriting the live file");
});

console.log(`\n${ok}/${total} checks passed${failed ? ` — ${failed} FAILED` : ""}`);
if (failed) process.exit(1);
