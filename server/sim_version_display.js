/**
 * Version display sim — batch 5.
 *
 * Before batch 5, every installer v1–v5 shipped version 0.1.0 and the app
 * showed NO version anywhere, so a bug report could not say which build it
 * came from (the batch-4 bundle, index-BzLSfRfC.js, contains zero "0.1.0"
 * and zero version markers — verified before the rebuild).
 *
 * This sim proves, with red-before/green-after on the previous commit:
 *   RED  (HEAD~1, the batch-4 commit): no version.ts, no Version page, no
 *        /version route, and the login screen has no version line.
 *   GREEN (working tree + built dist): the current version (package.json)
 *        is bumped everywhere — 0.1.1 for batch 5, 0.1.2 from batch 17 on,
 *        the login screen renders versionLine() under the lubric.app
 *        subtitle, the Version page shows every baked field, the sidebar
 *        offers it to every signed-in user, and the built bundle contains
 *        the baked version + head SHA + build date.
 *
 * The sim needs the built bundle, so it runs AFTER `npm run build` in the
 * gate (not with the pre-build sims). It proves the RED case against the
 * commit BEFORE batch 5, resolved dynamically (see RED_REF below), so CI
 * checks out the full history (fetch-depth 0).
 *
 * Run:  npm run build && node server/sim_version_display.js
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

const ROOT = new URL('..', import.meta.url);

let ok = 0, total = 0, failed = 0;
function check(title, fn) {
  total++;
  try { fn(); ok++; console.log(`ok - ${title}`); }
  catch (e) { failed++; console.log(`FAIL - ${title}: ${e.message}`); }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}
function read(rel) {
  return readFileSync(new URL(rel, ROOT), 'utf8');
}
function git(args) {
  return execSync(`git ${args}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function gitShow(ref, path) {
  try { return git(`show ${ref}:${path}`); }
  catch { return null; } // file does not exist at that ref
}
// Extract a REAL top-level function from a TS source file (same brace
// matching trick as sim_vps_port.js) so the pure helpers run as written.
function extractFunction(src, name) {
  const start = src.indexOf(`function ${name}(`);
  assert(start !== -1, `${name} not found`);
  let depth = 0, i = src.indexOf('{', start);
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) break; }
  }
  assert(depth === 0, `could not match braces for ${name}`);
  return src.slice(start, i + 1);
}

// ── RED: the commit before batch 5 had no version display anywhere ────────
// The RED ref is the PARENT of the commit that ADDED src/lib/version.ts,
// resolved dynamically. HEAD~1 was only correct for the batch-5 commit
// itself (1b0c422): the follow-up fix commit (c5fdee4) shifted HEAD~1 onto
// batch 5, where the version files already exist, and all four RED checks
// failed (CI run 45487870858, 13/17). The dynamic ref stays correct for
// every future commit; it needs the full history (workflow fetch-depth 0).
//
// Windows/cmd safety (CI run 45488573261 failed the sim step again after
// the first dynamic-ref fix): the git commands below avoid cmd's metacharacters
// entirely — NO caret (^ is cmd's escape character: `rev-parse <sha>^`
// mangles the closing quote of the cmd /c string and the command fails)
// and NO %H format (parse the default `commit <sha>` header instead).
// Tilde (~1) is already proven safe on the runner: the original sim ran
// `git show HEAD~1:...` there.
const logOut = git('log --diff-filter=A -1 -- src/lib/version.ts');
const introMatch = logOut.match(/^commit ([0-9a-f]{40})/m);
assert(introMatch, 'could not find the commit that added src/lib/version.ts');
const RED_REF = git(`rev-parse ${introMatch[1]}~1`);
check('RED: previous commit has no version.ts', () => {
  assert(gitShow(RED_REF, 'src/lib/version.ts') === null, `version.ts already existed at ${RED_REF}`);
});
check('RED: previous commit has no Version page', () => {
  assert(gitShow(RED_REF, 'src/modules/settings/Version.tsx') === null, `Version.tsx already existed at ${RED_REF}`);
});
check('RED: previous commit login has no version line', () => {
  const old = gitShow(RED_REF, 'src/modules/auth/Login.tsx');
  assert(old !== null, `could not read ${RED_REF} Login.tsx — shallow checkout? (CI needs fetch-depth 0)`);
  assert(!old.includes('versionLine'), `${RED_REF} Login.tsx already renders a version line`);
});
check('RED: previous commit has no /version route or sidebar entry', () => {
  const oldApp = gitShow(RED_REF, 'src/App.tsx');
  const oldLayout = gitShow(RED_REF, 'src/components/Layout.tsx');
  assert(oldApp !== null && oldLayout !== null, `could not read ${RED_REF} App/Layout — shallow checkout?`);
  assert(!oldApp.includes('path="/version"'), `${RED_REF} App.tsx already has a /version route`);
  assert(!oldLayout.includes('"/version"'), `${RED_REF} Layout.tsx already has a Version entry`);
});

// ── GREEN: current version bumped everywhere ─────────────────────────────────
// Batch 17 (2026-11-28): the version is no longer pinned to 0.1.1 — the
// updater compares the feed version against the installed one, so every
// release batch bumps the patch version (0.1.2 here). The expected version
// is read from package.json, and the other three files must agree with it.
const EXPECTED_VERSION = JSON.parse(read('package.json')).version;
assert(/^\d+\.\d+\.\d+$/.test(EXPECTED_VERSION), `package.json version is not semver: ${EXPECTED_VERSION}`);
check(`GREEN: version is ${EXPECTED_VERSION} in package.json, tauri.conf.json, Cargo.toml`, () => {
  assert(JSON.parse(read('src-tauri/tauri.conf.json')).version === EXPECTED_VERSION, `tauri.conf.json is not ${EXPECTED_VERSION}`);
  assert(read('src-tauri/Cargo.toml').includes(`version = "${EXPECTED_VERSION}"`), `Cargo.toml is not ${EXPECTED_VERSION}`);
});
check(`GREEN: Cargo.lock pins the app itself at ${EXPECTED_VERSION}`, () => {
  // \r?\n: on the Windows runner, checkout converts text files to CRLF,
  // so the entry reads `name = "lubric-app"\r\nversion = ...` and a
  // \n-only regex misses it (CI run 45479998849). Never rewrite the lock
  // file's line endings — tolerate them here instead.
  const lock = read('src-tauri/Cargo.lock');
  const m = lock.match(/name = "lubric-app"\r?\nversion = "([^"]+)"/);
  assert(m && m[1] === EXPECTED_VERSION, `lubric-app in Cargo.lock is ${m ? m[1] : 'missing'}`);
});

// The date helpers are TypeScript, and formatBuildDate reads the
// module-level MONTHS constant (formatBuildDateTime also calls
// formatBuildDate), so the extracted source needs its TS annotations
// stripped from the signature line and its free names injected as
// parameters — the function BODIES still run exactly as written.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function stripTsSignature(fnSrc) {
  const brace = fnSrc.indexOf('{');
  return fnSrc.slice(0, brace).replace(/:\s*[A-Za-z_$][\w<>\[\]\s|]*/g, '') + fnSrc.slice(brace);
}
let cachedFormatBuildDate = null;
function makeDateFn(name) {
  if (name === 'formatBuildDate') {
    if (!cachedFormatBuildDate) {
      cachedFormatBuildDate = new Function('MONTHS', `return (${stripTsSignature(extractFunction(VERSION_SRC, 'formatBuildDate'))})`)(MONTHS);
    }
    return cachedFormatBuildDate;
  }
  const formatBuildDate = makeDateFn('formatBuildDate');
  return new Function('MONTHS', 'formatBuildDate', `return (${stripTsSignature(extractFunction(VERSION_SRC, 'formatBuildDateTime'))})`)(MONTHS, formatBuildDate);
}

// ── GREEN: version.ts exposes every field + the exact login line ────────────
const VERSION_SRC = read('src/lib/version.ts');
check('GREEN: version.ts exports version, SHA, subject, build date, versionLine', () => {
  for (const name of ['APP_VERSION', 'GIT_SHA', 'GIT_SHA_SHORT', 'GIT_SUBJECT', 'BUILD_DATE', 'versionLine']) {
    assert(VERSION_SRC.includes(name), `version.ts does not export ${name}`);
  }
  assert(
    VERSION_SRC.includes('`v${APP_VERSION} • build ${GIT_SHA_SHORT} • ${formatBuildDate(BUILD_DATE)}`'),
    'versionLine template is not the agreed login line',
  );
});
check('GREEN: formatBuildDate formats an ISO date, passes "unknown" through', () => {
  const fn = makeDateFn('formatBuildDate');
  assert(fn('2026-11-25T01:30:00.000Z') === '25 Nov 2026', `got ${fn('2026-11-25T01:30:00.000Z')}`);
  assert(fn('unknown') === 'unknown', 'unknown date must pass through');
});
check('GREEN: formatBuildDateTime shows day + UTC time', () => {
  const fn = makeDateFn('formatBuildDateTime');
  assert(fn('2026-11-25T01:30:00.000Z') === '25 Nov 2026, 01:30 UTC', `got ${fn('2026-11-25T01:30:00.000Z')}`);
});

// ── GREEN: login screen renders the line before sign-in ─────────────────────
check('GREEN: login renders versionLine() under the lubric.app subtitle', () => {
  const login = read('src/modules/auth/Login.tsx');
  assert(login.includes('import { versionLine } from "../../lib/version"'), 'Login does not import versionLine');
  const sub = login.indexOf('>lubric.app</div>');
  assert(sub !== -1, 'lubric.app subtitle not found');
  const line = login.indexOf('{versionLine()}', sub);
  assert(line !== -1, 'versionLine() is not rendered after the lubric.app subtitle');
});

// ── GREEN: Version page shows every baked field ─────────────────────────────
check('GREEN: Version page shows version, short + full SHA, built date, subject', () => {
  const page = read('src/modules/settings/Version.tsx');
  for (const field of ['APP_VERSION', 'GIT_SHA_SHORT', 'GIT_SHA', 'formatBuildDateTime(BUILD_DATE)', 'GIT_SUBJECT']) {
    assert(page.includes(field), `Version page does not show ${field}`);
  }
});

// ── GREEN: route + sidebar, open to every signed-in user ────────────────────
check('GREEN: /version route exists with no permission gate', () => {
  const app = read('src/App.tsx');
  assert(app.includes('import Version from "./modules/settings/Version"'), 'App.tsx does not import Version');
  assert(app.includes('<Route path="/version" element={<Version />} />'), '/version route missing or permission-gated');
});
check('GREEN: sidebar offers Version to everyone (cashiers included)', () => {
  const layout = read('src/components/Layout.tsx');
  assert(layout.includes('{ to: "/version", label: "Version"'), 'no Version nav entry');
  assert(layout.includes('everyone: true'), 'Version entry is not flagged everyone');
  assert(layout.includes('if (item.everyone) return true;'), 'visible() does not honour everyone entries');
});

// ── GREEN: the built bundle carries the baked identity ──────────────────────
const HEAD_SHA = git('rev-parse HEAD');
const HEAD_SHORT = HEAD_SHA.slice(0, 7);
function mainBundle() {
  const dir = new URL('dist/assets/', ROOT);
  assert(existsSync(dir), 'dist/assets does not exist — run npm run build first');
  const files = readdirSync(dir).filter((f) => /^index-.*\.js$/.test(f));
  assert(files.length > 0, 'no built index-*.js bundle in dist/assets');
  for (const f of files) {
    const text = readFileSync(new URL(f, dir), 'utf8');
    if (text.includes(EXPECTED_VERSION)) return text;
  }
  throw new Error(`no built bundle contains the baked version ${EXPECTED_VERSION}`);
}
const BUNDLE = mainBundle();
check(`GREEN: built bundle contains the baked version ${EXPECTED_VERSION}`, () => {
  assert(BUNDLE.includes(`"${EXPECTED_VERSION}"`) || BUNDLE.includes(EXPECTED_VERSION), `bundle lacks ${EXPECTED_VERSION}`);
});
check('GREEN: built bundle contains the head commit SHA (full + short)', () => {
  assert(BUNDLE.includes(HEAD_SHA), `bundle lacks full head SHA ${HEAD_SHA}`);
  assert(BUNDLE.includes(HEAD_SHORT), `bundle lacks short head SHA ${HEAD_SHORT}`);
});
check('GREEN: built bundle contains the version-line fragment', () => {
  assert(BUNDLE.includes('• build '), 'bundle lacks the "• build " version-line fragment');
});
check('GREEN: built bundle contains a recent ISO build date', () => {
  // \.\d{1,7}Z: the workflow used to emit .NET's "o" format with SEVEN
  // fractional digits (2026-11-25T01:23:45.1234567Z); the old \.\d{3}Z
  // regex missed it (CI run 45479998849). The workflow now emits a
  // canonical 3-digit timestamp, and the sim accepts 1–7 digits either way.
  const stamps = BUNDLE.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{1,7}Z/g) || [];
  assert(stamps.length > 0, 'bundle contains no ISO-8601 UTC timestamp');
  const now = Date.now();
  const fresh = stamps.some((s) => {
    const t = Date.parse(s);
    return !Number.isNaN(t) && t <= now && now - t < 7 * 24 * 60 * 60 * 1000;
  });
  assert(fresh, `no ISO timestamp in the bundle is from the last 7 days (found: ${stamps.slice(0, 3).join(', ')})`);
});

console.log(`\n${ok}/${total} checks passed${failed ? ` — ${failed} FAILED` : ''}`);
console.log(`head ${HEAD_SHORT} (${HEAD_SHA}) — login will show: v${EXPECTED_VERSION} • build ${HEAD_SHORT} • <build date>`);
if (failed) process.exit(1);
