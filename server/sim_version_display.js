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
 *   GREEN (working tree + built dist): version 0.1.1 is bumped everywhere,
 *        the login screen renders versionLine() under the lubric.app
 *        subtitle, the Version page shows every baked field, the sidebar
 *        offers it to every signed-in user, and the built bundle contains
 *        the baked version + head SHA + build date.
 *
 * The sim needs the built bundle, so it runs AFTER `npm run build` in the
 * gate (not with the pre-build sims). It needs HEAD~1, so CI checks out
 * with fetch-depth 2.
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

// ── RED: the previous commit had no version display anywhere ────────────────
check('RED: previous commit has no version.ts', () => {
  assert(gitShow('HEAD~1', 'src/lib/version.ts') === null, 'version.ts already existed at HEAD~1');
});
check('RED: previous commit has no Version page', () => {
  assert(gitShow('HEAD~1', 'src/modules/settings/Version.tsx') === null, 'Version.tsx already existed at HEAD~1');
});
check('RED: previous commit login has no version line', () => {
  const old = gitShow('HEAD~1', 'src/modules/auth/Login.tsx');
  assert(old !== null, 'could not read HEAD~1 Login.tsx — shallow checkout? (CI needs fetch-depth 2)');
  assert(!old.includes('versionLine'), 'HEAD~1 Login.tsx already renders a version line');
});
check('RED: previous commit has no /version route or sidebar entry', () => {
  const oldApp = gitShow('HEAD~1', 'src/App.tsx');
  const oldLayout = gitShow('HEAD~1', 'src/components/Layout.tsx');
  assert(oldApp !== null && oldLayout !== null, 'could not read HEAD~1 App/Layout — shallow checkout?');
  assert(!oldApp.includes('path="/version"'), 'HEAD~1 App.tsx already has a /version route');
  assert(!oldLayout.includes('"/version"'), 'HEAD~1 Layout.tsx already has a Version entry');
});

// ── GREEN: version bumped to 0.1.1 everywhere ───────────────────────────────
check('GREEN: version is 0.1.1 in package.json, tauri.conf.json, Cargo.toml', () => {
  assert(JSON.parse(read('package.json')).version === '0.1.1', 'package.json is not 0.1.1');
  assert(JSON.parse(read('src-tauri/tauri.conf.json')).version === '0.1.1', 'tauri.conf.json is not 0.1.1');
  assert(read('src-tauri/Cargo.toml').includes('version = "0.1.1"'), 'Cargo.toml is not 0.1.1');
});
check('GREEN: Cargo.lock pins the app itself at 0.1.1', () => {
  // \r?\n: on the Windows runner, checkout converts text files to CRLF,
  // so the entry reads `name = "lubric-app"\r\nversion = ...` and a
  // \n-only regex misses it (CI run 45479998849). Never rewrite the lock
  // file's line endings — tolerate them here instead.
  const lock = read('src-tauri/Cargo.lock');
  const m = lock.match(/name = "lubric-app"\r?\nversion = "([^"]+)"/);
  assert(m && m[1] === '0.1.1', `lubric-app in Cargo.lock is ${m ? m[1] : 'missing'}`);
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
    if (text.includes('0.1.1')) return text;
  }
  throw new Error('no built bundle contains the baked version 0.1.1');
}
const BUNDLE = mainBundle();
check('GREEN: built bundle contains the baked version 0.1.1', () => {
  assert(BUNDLE.includes('"0.1.1"') || BUNDLE.includes('0.1.1'), 'bundle lacks 0.1.1');
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
console.log(`head ${HEAD_SHORT} (${HEAD_SHA}) — login will show: v0.1.1 • build ${HEAD_SHORT} • <build date>`);
if (failed) process.exit(1);
