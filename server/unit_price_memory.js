/**
 * Unit tests for the pure price-memory logic (src/lib/priceMemory.ts).
 *
 * No browser and no database: the module is deliberately free of both, and
 * Node strips the types the same way server/e2e_pairing.js already does for
 * src/lib/uuid.ts. The rules worth pinning down are the ones that are easy to
 * get subtly wrong and hard to notice on a counter:
 *
 *   - capacity narrows the memory to that exact fill size
 *   - 3.5 and 3.50 match; 3.5 and 3.7 do not
 *   - with no capacity entered, nothing is filtered out
 *   - litres fall back to the pack size when a past sale recorded none
 *   - the SQL never uses `= ANY`, which pgToSqlite cannot translate
 *
 * Run:  node --experimental-strip-types unit_price_memory.js
 */

import {
  buildPriceMemory,
  formatMemoryLine,
  trimNumber,
  PRICE_MEMORY_SQL,
  WALKING_PROMOTION_THRESHOLD,
} from '../src/lib/priceMemory.ts';

let ok = 0, total = 0;
function check(title, fn) {
  total++;
  try {
    fn();
    ok++;
    console.log('  PASS ' + title);
  } catch (e) {
    console.log('  FAIL ' + title + ': ' + e.message);
  }
}
function assert(c, m) {
  if (!c) throw new Error(m || 'assertion failed');
}
function eq(a, b, m) {
  if (a !== b) {
    throw new Error((m || 'not equal') + ': got ' + JSON.stringify(a) + ', expected ' + JSON.stringify(b));
  }
}

const CUR = (n) => 'Rs ' + n;

/** A past sale. `cap` 0 means no capacity was recorded (whole bottle). */
function row(over = {}) {
  return {
    ref_id: 1,
    product_name: 'Castrol GTX',
    unit_price: 4000,
    qty: 1,
    capacity: 0,
    billed_by_capacity: false,
    order_id: 1,
    created_at: '2026-09-30T10:00:00.000Z',
    ...over,
  };
}

console.log('\nPrice memory (pure logic)');

check('keeps the newest sale per product when nothing is filtered', () => {
  const rows = [
    row({ order_id: 3, unit_price: 3000, created_at: '2026-09-20T10:00:00.000Z' }),
    row({ order_id: 2, unit_price: 3500, created_at: '2026-09-25T10:00:00.000Z' }),
    row({ order_id: 1, unit_price: 4000, created_at: '2026-09-30T10:00:00.000Z' }),
  ];
  const list = buildPriceMemory(rows).get(1);
  eq(list.length, 2, 'should keep two');
  eq(list[0].unitPrice, 4000, 'newest first');
  eq(list[1].unitPrice, 3500, 'then the one before');
});

check('respects the limit', () => {
  const rows = [
    row({ order_id: 3, unit_price: 1 }),
    row({ order_id: 2, unit_price: 2 }),
    row({ order_id: 1, unit_price: 3 }),
    row({ order_id: 0, unit_price: 4 }),
  ];
  eq(buildPriceMemory(rows, { limit: 1 }).get(1).length, 1);
  eq(buildPriceMemory(rows, { limit: 3 }).get(1).length, 3);
});

check('an entered capacity narrows memory to that fill size', () => {
  const rows = [
    row({ order_id: 2, unit_price: 4000, capacity: 4 }),
    row({ order_id: 1, unit_price: 3500, capacity: 3.5 }),
  ];
  const list = buildPriceMemory(rows, { wantedLitres: { 1: 3.5 } }).get(1);
  eq(list.length, 1, 'only the 3.5L fill should match');
  eq(list[0].unitPrice, 3500);
  eq(list[0].litres, 3.5);
});

check('3.5 and 3.50 are the same fill; 3.7 is not', () => {
  const rows = [row({ unit_price: 3500, capacity: 3.5 })];
  eq(buildPriceMemory(rows, { wantedLitres: { 1: 3.5 } }).get(1).length, 1, '3.5 matches');
  // Nothing matched, so the product is simply absent - the screen renders an
  // empty list, and must not fall back to an unrelated price.
  const none = buildPriceMemory(rows, { wantedLitres: { 1: 3.7 } }).get(1);
  eq(none === undefined || none.length === 0, true, '3.7 must not match');
});

check('order does not depend on the caller sorting the rows', () => {
  // Ascending by date, which is the WRONG order for "last price". If the
  // function trusted the caller this returns the oldest bill and labels it
  // "last", which is the worst kind of wrong.
  const rows = [
    row({ order_id: 1, unit_price: 3000, created_at: '2026-09-01T10:00:00.000Z' }),
    row({ order_id: 2, unit_price: 4000, created_at: '2026-09-30T10:00:00.000Z' }),
  ];
  const list = buildPriceMemory(rows).get(1);
  eq(list[0].unitPrice, 4000, 'newest must come first regardless of input order');
  eq(list[1].unitPrice, 3000);
});

check('no capacity entered shows everything, each with its own litre value', () => {
  const rows = [
    row({ order_id: 2, unit_price: 4000, capacity: 4 }),
    row({ order_id: 1, unit_price: 3500, capacity: 3.5 }),
  ];
  const list = buildPriceMemory(rows).get(1);
  eq(list.length, 2, 'nothing is hidden when no capacity was typed');
  eq(list[0].litres, 4);
  eq(list[1].litres, 3.5);
});

check('a past sale with no capacity falls back to the pack size', () => {
  const list = buildPriceMemory([row({ capacity: 0, unit_price: 4000 })], { packLitres: { 1: 4 } }).get(1);
  eq(list[0].litres, 4, 'a whole bottle counts as the pack size');
});

check('the pack-size fallback can still be matched against a capacity', () => {
  const rows = [row({ capacity: 0, unit_price: 4000 })];
  const mem = buildPriceMemory(rows, { packLitres: { 1: 4 }, wantedLitres: { 1: 4 } });
  eq(mem.get(1).length, 1, 'asking for 4L of a 4L pack matches the whole-bottle sale');
});

check('capacity billing is flagged, so a fractional price is not read as a bottle price', () => {
  const rows = [row({ capacity: 3.5, unit_price: 3500, billed_by_capacity: true })];
  eq(buildPriceMemory(rows).get(1)[0].prorated, true);
  eq(buildPriceMemory([row({ billed_by_capacity: false })]).get(1)[0].prorated, false);
});

check('products are kept apart', () => {
  const mem = buildPriceMemory([row({ ref_id: 1, unit_price: 100 }), row({ ref_id: 2, unit_price: 200 })]);
  eq(mem.size, 2);
  eq(mem.get(1)[0].unitPrice, 100);
  eq(mem.get(2)[0].unitPrice, 200);
});

check('junk and empty input do not throw', () => {
  eq(buildPriceMemory([]).size, 0);
  eq(buildPriceMemory(undefined).size, 0);
  eq(buildPriceMemory([row({ ref_id: NaN })]).size, 0, 'a row with no product id is dropped');
});

check('a line renders as litres, price and date', () => {
  const m = buildPriceMemory([row({ capacity: 3.5, unit_price: 3500 })]).get(1)[0];
  eq(formatMemoryLine(m, CUR), '3.5L · Rs 3500 · 2026-09-30');
});

check('quantity above one is shown compactly', () => {
  const m = buildPriceMemory([row({ qty: 2, unit_price: 3500 })]).get(1)[0];
  eq(formatMemoryLine(m, CUR).includes('×2'), true, 'expected a ×2 marker');
});

check('a sale with no litres at all still renders', () => {
  const m = buildPriceMemory([row()]).get(1)[0];
  eq(formatMemoryLine(m, CUR).startsWith('full · '), true);
});

check('trailing zeros are trimmed', () => {
  eq(trimNumber(3.5), '3.5');
  eq(trimNumber(3.50), '3.5');
  eq(trimNumber(4), '4');
  eq(trimNumber(0.1 + 0.2), '0.3');
});

check('the SQL scopes to a completed bill for one customer', () => {
  const sql = PRICE_MEMORY_SQL(7, 3);
  assert(sql.includes('o.customer_id = $1'), 'must scope to the customer');
  assert(sql.includes("o.status = 'completed'"), 'must exclude voided bills');
  assert(sql.includes("oi.kind = 'product'"), 'must exclude services');
  assert(sql.includes('oi.ref_id IN ($2, $3, $4)'), 'must batch the whole cart');
});

check('the SQL never uses = ANY, which offline mode cannot translate', () => {
  assert(!/=\s*ANY/i.test(PRICE_MEMORY_SQL(1, 4)), '= ANY breaks the SQLite path');
});

check('the walking promotion threshold is a named, non-magic number', () => {
  eq(WALKING_PROMOTION_THRESHOLD, 3);
});

console.log('\n' + ok + '/' + total + ' checks passed');
process.exit(ok === total ? 0 : 1);