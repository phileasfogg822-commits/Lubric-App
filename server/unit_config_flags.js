/**
 * Unit tests for the pure white-label rules in src/lib/configRules.ts.
 *
 * These are the functions every screen gates on (nav, routes, future page
 * gates), and they all FAIL OPEN by design — so the tests pin both halves:
 * that a real manifest/flag is honoured exactly, and that garbage in (missing,
 * malformed, offline-empty) degrades to "everything on" instead of an empty
 * app. configRules.ts imports nothing from the data layer precisely so this
 * file can run it under plain node.
 *
 * Run:  node --experimental-strip-types unit_config_flags.js
 */

import { moduleList, moduleEnabled, pickFlag } from '../src/lib/configRules.ts';

let ok = 0, total = 0;
async function check(title, fn) {
  total++;
  try {
    await fn();
    ok++;
    console.log('  PASS ' + title);
  } catch (e) {
    console.log('  FAIL ' + title + ': ' + e.message);
  }
}
function assert(c, m) {
  if (!c) throw new Error(m || 'assertion failed');
}

console.log('\nWhite-label config rules (configRules.ts)');

const FULL = JSON.stringify([
  'dashboard', 'pos.create', 'sales_history', 'catalog.manage', 'customers',
  'vendors', 'accounts', 'expenses.manage', 'purchase.manage', 'inspections',
  'reports', 'profit_loss', 'team.manage', 'shop.manage',
]);
const MINIMAL = JSON.stringify(['dashboard', 'shop.manage']);

await check('a missing manifest parses as null', async () => {
  assert(moduleList(undefined) === null, 'undefined should be null');
  assert(moduleList(null) === null, 'null should be null');
  assert(moduleList('') === null, 'empty string should be null');
});

await check('a missing manifest fails OPEN: every module is included', async () => {
  for (const k of ['pos.create', 'profit_loss', 'whatever']) {
    assert(moduleEnabled(undefined, k) === true, k + ' should default to included');
  }
});

await check('a valid manifest includes what it lists', async () => {
  const list = moduleList(FULL);
  assert(Array.isArray(list) && list.length === 14, 'expected the 14 seeded modules');
  assert(moduleEnabled(FULL, 'pos.create') === true, 'pos.create is in the manifest');
  assert(moduleEnabled(FULL, 'dashboard') === true, 'dashboard is in the manifest');
});

await check('a valid manifest excludes what it omits', async () => {
  assert(moduleEnabled(MINIMAL, 'pos.create') === false, 'pos.create not in minimal package');
  assert(moduleEnabled(MINIMAL, 'profit_loss') === false, 'profit_loss not in minimal package');
  assert(moduleEnabled(MINIMAL, 'dashboard') === true, 'dashboard is in minimal package');
});

await check('malformed JSON fails OPEN instead of blanking the app', async () => {
  for (const bad of ['not json', '[', '{"a":1}', '42', '"pos.create"']) {
    assert(moduleList(bad) === null, JSON.stringify(bad) + ' should parse as null');
    assert(moduleEnabled(bad, 'pos.create') === true,
      JSON.stringify(bad) + ' should fail open to included');
  }
});

await check('non-string entries in the manifest are dropped', async () => {
  const list = moduleList('["dashboard", 7, null, "reports"]');
  assert(list && list.length === 2, 'expected 2 string modules, got ' + JSON.stringify(list));
  assert(moduleEnabled('["dashboard", 7, null, "reports"]', 'reports') === true, 'reports kept');
  assert(moduleEnabled('["dashboard", 7, null, "reports"]', '7') === false, 'number coerced to nothing');
});

await check('an unknown flag fails OPEN (enabled)', async () => {
  assert(pickFlag([], 'brand_new_flag') === true, 'no rows should mean enabled');
});

await check('a global flag row is honoured', async () => {
  const rows = [{ key: 'inspections', enabled: true, shop_id: null }];
  assert(pickFlag(rows, 'inspections') === true, 'enabled row should be true');
  rows[0].enabled = false;
  assert(pickFlag(rows, 'inspections') === false, 'disabled row should be false');
});

await check('a per-outlet row beats the global row for that outlet', async () => {
  const rows = [
    { key: 'pos.create', enabled: true, shop_id: null },
    { key: 'pos.create', enabled: false, shop_id: 2 },
  ];
  assert(pickFlag(rows, 'pos.create', 2) === false, 'outlet 2 override should win');
  assert(pickFlag(rows, 'pos.create', 1) === true, 'outlet 1 falls back to global');
  assert(pickFlag(rows, 'pos.create') === true, 'no shopId uses the global row');
});

await check('a shopId with only a global row resolves globally', async () => {
  const rows = [{ key: 'reports', enabled: false, shop_id: null }];
  assert(pickFlag(rows, 'reports', 7) === false, 'global value should apply');
});

await check('a shopId with only ANOTHER outlet’s row falls back, not to it', async () => {
  const rows = [
    { key: 'reports', enabled: false, shop_id: 2 },
    { key: 'reports', enabled: true, shop_id: null },
  ];
  assert(pickFlag(rows, 'reports', 5) === true, 'unrelated override must not leak');
});

await check('flag rows with a wrong shape fail OPEN', async () => {
  assert(pickFlag([{ key: 'x' }], 'x') === true, 'missing enabled should read as on');
  assert(pickFlag([{}], 'x') === true, 'garbage row, unknown key → on');
});

console.log('\n' + ok + '/' + total + ' checks passed');
process.exit(ok === total ? 0 : 1);