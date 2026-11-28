/**
 * Batch 17 (2026-11-28): in-app updates (Tauri updater, GitHub Releases feed).
 *
 * Rules as built:
 *   - The feed is the `latest.json` CI publishes to the rolling
 *     `windows-latest` GitHub Release: { version, notes?, pub_date?,
 *     platforms: { "windows-x86_64": { url, signature } } }. The signature
 *     is the CONTENT of the .exe.sig file, never a path. A bad feed is a
 *     silent no-op, never an error.
 *   - An update is offered only when the feed version is a valid semver
 *     strictly newer than the installed version. Same, older, or
 *     unparseable versions are never offered.
 *   - NOTHING downloads or installs until the user taps "Update now".
 *     The install goes through the Tauri updater plugin, which verifies
 *     the minisign signature against the public key baked into
 *     tauri.conf.json before installing anything.
 *   - The app version bumps every release batch (0.1.2 here): the updater
 *     compares versions, so a feed at the installed version is never an
 *     update. package.json, tauri.conf.json, Cargo.toml and Cargo.lock
 *     must agree on the version.
 *   - CI stays GREEN before the signing secret exists: the base config
 *     does NOT set createUpdaterArtifacts (the build would fail without
 *     the key) — the signed build only happens through the
 *     tauri.updater.conf.json overlay, and the release step skips cleanly
 *     when TAURI_SIGNING_PRIVATE_KEY is absent.
 *
 * The pure feed logic is driven through the REAL src/lib/updater.ts
 * (imported); the config, capabilities, Rust registration and workflow
 * wiring are checked against the real files.
 *
 * Run:  node --experimental-strip-types server/sim_updater_feed.js
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  UPDATER_FEED_URL,
  UPDATER_TARGET,
  compareVersions,
  isNewerVersion,
  parseSemver,
  parseUpdaterFeed,
} from "../src/lib/updater.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(ROOT + p, "utf8");

let ok = 0, total = 0, failed = 0;
function check(title, fn) {
  total++;
  try { fn(); ok++; console.log(`  PASS ${title}`); }
  catch (e) { failed++; console.log(`  FAIL ${title}: ${e.message}`); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }
function assertEq(a, b, msg) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }

// ── semver parsing + comparison ─────────────────────────────────────────
check("parseSemver: plain, v-prefixed, short, and build metadata", () => {
  assertEq(parseSemver("0.1.2"), [0, 1, 2], "plain");
  assertEq(parseSemver("v1.2.3"), [1, 2, 3], "v-prefixed");
  assertEq(parseSemver("1.0"), [1, 0, 0], "short fills zeros");
  assertEq(parseSemver("0.1.2+build.847d0b4"), [0, 1, 2], "build metadata ignored");
});
check("parseSemver: garbage yields null", () => {
  for (const bad of ["", "abc", "1.2.3.4", "1.x.3", null, undefined, 12, "0.1.2-"]) {
    assertEq(parseSemver(bad), null, `input ${JSON.stringify(bad)}`);
  }
});
check("isNewerVersion: newer offered, same/older/unparseable never offered", () => {
  assert(isNewerVersion("0.1.1", "0.1.2"), "0.1.2 is newer than 0.1.1");
  assert(isNewerVersion("0.1.2", "0.2.0"), "0.2.0 is newer than 0.1.2");
  assert(!isNewerVersion("0.1.2", "0.1.2"), "same version is not an update");
  assert(!isNewerVersion("0.1.2", "0.1.1"), "older version is not an update");
  assert(!isNewerVersion("0.1.2", "v0.1.2"), "same version with v prefix is not an update");
  assert(!isNewerVersion("0.1.2", "banana"), "unparseable feed version is not an update");
  assert(!isNewerVersion("banana", "0.1.3"), "unparseable installed version is not an update");
});
check("compareVersions orders major/minor/patch", () => {
  assertEq(compareVersions("1.0.0", "2.0.0"), -1, "major");
  assertEq(compareVersions("0.2.0", "0.10.0"), -1, "numeric, not lexicographic");
  assertEq(compareVersions("0.1.2", "0.1.2"), 0, "equal");
  assertEq(compareVersions("0.1.3", "0.1.2"), 1, "patch");
});

// ── feed parsing ────────────────────────────────────────────────────────
function goodFeed() {
  return {
    version: "0.1.2",
    notes: "Trial licensing fixes",
    pub_date: "2026-11-28T11:00:00Z",
    platforms: {
      "windows-x86_64": {
        url: "https://github.com/phileasfogg822-commits/Lubric-App/releases/download/windows-latest/lubric.app_0.1.2_x64-setup.exe",
        signature: "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVJPT0K",
      },
    },
  };
}
check("parseUpdaterFeed: valid latest.json parses with all fields", () => {
  const f = parseUpdaterFeed(goodFeed());
  assert(f !== null, "valid feed must parse");
  assertEq(f.version, "0.1.2", "version");
  assertEq(f.url, goodFeed().platforms["windows-x86_64"].url, "url");
  assert(f.signature.length > 0, "signature kept");
});
check("parseUpdaterFeed: missing platform/signature/url/version yields null", () => {
  const noPlatform = goodFeed(); delete noPlatform.platforms;
  assertEq(parseUpdaterFeed(noPlatform), null, "no platforms");
  const linuxOnly = goodFeed();
  linuxOnly.platforms = { "linux-x86_64": { url: "https://x/y", signature: "sig" } };
  assertEq(parseUpdaterFeed(linuxOnly), null, "no windows-x86_64 entry");
  const noSig = goodFeed(); noSig.platforms["windows-x86_64"].signature = "";
  assertEq(parseUpdaterFeed(noSig), null, "empty signature");
  const noUrl = goodFeed(); noUrl.platforms["windows-x86_64"].url = "  ";
  assertEq(parseUpdaterFeed(noUrl), null, "blank url");
  const badVersion = goodFeed(); badVersion.version = "next";
  assertEq(parseUpdaterFeed(badVersion), null, "bad version");
  for (const bad of [null, "nope", 42, {}, []]) {
    assertEq(parseUpdaterFeed(bad), null, `shape ${JSON.stringify(bad)}`);
  }
});
check("parseUpdaterFeed: notes/pub_date are optional", () => {
  const f = goodFeed(); delete f.notes; delete f.pub_date;
  const out = parseUpdaterFeed(f);
  assert(out !== null && out.notes === "" && out.pubDate === "", "optional fields default to empty");
});

// ── config: pubkey, endpoints, overlay ──────────────────────────────────
check("tauri.conf.json: updater pubkey is a real minisign public key", () => {
  const conf = JSON.parse(read("src-tauri/tauri.conf.json"));
  const pubkey = conf.plugins?.updater?.pubkey;
  assert(typeof pubkey === "string" && pubkey.length > 0, "pubkey missing");
  const text = Buffer.from(pubkey, "base64").toString("utf8");
  assert(text.includes("minisign public key:"), "pubkey is not a minisign public key");
  const inner = text.trim().split("\n").pop();
  const raw = Buffer.from(inner, "base64");
  assertEq(raw.length, 42, "public key must be 42 bytes");
  assertEq(raw.subarray(0, 2).toString(), "Ed", "public key must start with the Ed magic");
});
check("tauri.conf.json: endpoints point at the rolling release feed, HTTPS", () => {
  const conf = JSON.parse(read("src-tauri/tauri.conf.json"));
  const endpoints = conf.plugins?.updater?.endpoints;
  assert(Array.isArray(endpoints) && endpoints.length > 0, "no updater endpoints");
  assertEq(endpoints[0], UPDATER_FEED_URL, "endpoint must equal UPDATER_FEED_URL");
  assert(endpoints[0].startsWith("https://"), "updater endpoints must be HTTPS");
  assertEq(conf.plugins.updater.windows?.installMode, "passive", "windows installMode must be passive");
});
check("tauri.conf.json: NO createUpdaterArtifacts in the base config", () => {
  const conf = JSON.parse(read("src-tauri/tauri.conf.json"));
  assert(!("createUpdaterArtifacts" in (conf.bundle ?? {})), "base config must not set createUpdaterArtifacts — the build fails without the signing key");
});
check("updater overlay config enables artifacts for signed release builds", () => {
  const overlay = JSON.parse(read("src-tauri/tauri.updater.conf.json"));
  assertEq(overlay.bundle?.createUpdaterArtifacts, true, "overlay must set createUpdaterArtifacts");
});
check("capabilities grant the updater + process plugins", () => {
  const caps = JSON.parse(read("src-tauri/capabilities/default.json"));
  assert(caps.permissions.includes("updater:default"), "updater:default missing");
  assert(caps.permissions.includes("process:default"), "process:default missing");
});
check("lib.rs registers both plugins", () => {
  const lib = read("src-tauri/src/lib.rs");
  assert(lib.includes("tauri_plugin_updater::Builder::new().build()"), "updater plugin not registered");
  assert(lib.includes("tauri_plugin_process::init()"), "process plugin not registered");
});
check("Cargo.toml + package.json carry both plugin packages", () => {
  const cargo = read("src-tauri/Cargo.toml");
  assert(cargo.includes('tauri-plugin-updater = { version = "2" }'), "updater crate missing");
  assert(cargo.includes('tauri-plugin-process = { version = "2" }'), "process crate missing");
  const pkg = JSON.parse(read("package.json"));
  assert(pkg.devDependencies["@tauri-apps/plugin-updater"], "updater JS package missing");
  assert(pkg.devDependencies["@tauri-apps/plugin-process"], "process JS package missing");
});

// ── version consistency (0.1.2 from batch 17) ───────────────────────────
check("version 0.1.2 agrees across package.json, tauri.conf.json, Cargo.toml, Cargo.lock", () => {
  const pkg = JSON.parse(read("package.json"));
  assertEq(pkg.version, "0.1.2", "package.json");
  assertEq(JSON.parse(read("src-tauri/tauri.conf.json")).version, "0.1.2", "tauri.conf.json");
  assert(read("src-tauri/Cargo.toml").includes('version = "0.1.2"'), "Cargo.toml");
  const lock = read("src-tauri/Cargo.lock");
  const m = lock.match(/name = "lubric-app"\r?\nversion = "([^"]+)"/);
  assert(m && m[1] === "0.1.2", `Cargo.lock pins ${m ? m[1] : "nothing"}`);
});

// ── client: never auto-installs, Tauri-gated, no identity ───────────────
check("updater client: check is Tauri-gated and sends no identity", () => {
  const src = read("src/lib/updaterClient.ts");
  assert(src.includes("if (!isTauri()) return null"), "update check must be Tauri-gated");
  assert(src.includes("credentials: \"omit\""), "feed fetch must send no credentials");
  assert(!src.includes("authHeaders"), "feed fetch must never attach auth headers");
  assert(!src.includes("downloadAndInstall") || src.indexOf("downloadAndInstall") > src.indexOf("export async function installUpdate"), "downloadAndInstall must live only in installUpdate");
});
check("update prompt: install happens only from the user's tap", () => {
  const ui = read("src/components/UpdatePrompt.tsx");
  assert(ui.includes("Update now"), "prompt must offer an Update now button");
  assert(ui.includes("Later"), "prompt must offer a Later button");
  assert(ui.includes("onClick={startUpdate}"), "install must start from the button tap");
  assert(!ui.includes("downloadAndInstall"), "component must not install directly — only via installUpdate()");
  const client = read("src/lib/updaterClient.ts");
  assert(client.includes("await relaunch()"), "installed update must restart the app");
  const layout = read("src/components/Layout.tsx");
  assert(layout.includes("<UpdatePrompt />"), "update prompt not mounted in Layout");
});

// ── workflow: release step skips cleanly without the signing secret ─────
check("workflow: release step is secret-gated and publishes the feed", () => {
  const wf = read(".github/workflows/windows-app.yml");
  assert(wf.includes("Publish updater release"), "release step missing");
  assert(wf.includes("TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}"), "signing secret must be hoisted into a job-level env var (secrets is rejected inside if:)");
  assert(wf.includes("if: ${{ env.TAURI_SIGNING_PRIVATE_KEY != '' }}"), "release step must skip via the env var when the signing secret is absent");
  assert(!wf.includes("if: ${{ secrets."), "no step if: may reference secrets directly — GitHub rejects the whole workflow file");
  assert(wf.includes("--config src-tauri/tauri.updater.conf.json"), "signed build must use the updater overlay config");
  assert(wf.includes("TAURI_SIGNING_PRIVATE_KEY"), "build must receive the signing key from the secret");
  assert(wf.includes("gh release upload"), "release step must upload to GitHub Releases");
  assert(wf.includes("windows-latest"), "release must be the rolling windows-latest release");
  assert(wf.includes("latest.json"), "release step must publish latest.json");
  assert(wf.includes("$sigFile"), "release step must read the .sig file for the feed signature");
  assert(wf.includes("sim_announcements.js"), "announcements sim not in the gate");
  assert(wf.includes("sim_updater_feed.js"), "updater sim not in the gate");
});

// ── JS/Rust Tauri version alignment ───────────────────────────────────────
// CI 46142127144 (2026-11-28): the Tauri CLI refuses to build when the JS
// @tauri-apps/api minor differs from the Rust `tauri` crate minor —
// "Found version mismatched Tauri packages" — and it fails in ~3 seconds,
// before any compilation. The batch-17 `npm install` had floated the root
// api to 2.12.5 (the new plugins want ^2.12.0) while Cargo.lock still pins
// tauri 2.11.5. The fix: the ROOT api stays pinned to the 2.11 line
// (package.json: "2.11.1") and the plugins get their own nested 2.13 copy
// under node_modules/@tauri-apps/plugin-*/node_modules — npm nests it
// automatically. When the Rust tauri is next bumped (cargo refreshes the
// lock on CI), this pin must move with it.
check("versions: root @tauri-apps/api minor matches Rust tauri minor in Cargo.lock", () => {
  const lock = JSON.parse(read("package-lock.json"));
  const jsApi = lock.packages["node_modules/@tauri-apps/api"].version;
  const cargoLock = read("src-tauri/Cargo.lock");
  const m = cargoLock.match(/name = "tauri"\nversion = "([^"]+)"/);
  assert(m, "tauri entry not found in Cargo.lock");
  const rustTauri = m[1];
  const minor = (v) => v.split(".").slice(0, 2).join(".");
  assertEq(minor(jsApi), minor(rustTauri), `JS @tauri-apps/api ${jsApi} minor must equal Rust tauri ${rustTauri} minor`);
  const pkg = JSON.parse(read("package.json"));
  assertEq(pkg.devDependencies["@tauri-apps/api"], jsApi, "package.json must pin the exact root api version (no ^ range — npm would float it past the Rust minor)");
});

console.log(`\n${ok}/${total} checks passed${failed ? ` — ${failed} FAILED` : ""}`);
if (failed) process.exit(1);
