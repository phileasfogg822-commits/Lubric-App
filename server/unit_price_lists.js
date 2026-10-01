/**
 * Unit tests for price resolution (spec §27 price_list, §220 party_price).
 *
 * No server needed - the resolver is pure, which is the reason it was extracted
 * from the components in the first place.
 *
 * What is checked:
 *   1. an individually agreed price beats the customer's list
 *   2. the list beats the legacy tier columns
 *   3. the legacy columns still work exactly as before, unchanged
 *   4. a quantity break applies at and above its threshold, NOT below it
 *   5. the highest reached break wins, and an unreached one is ignored
 *   6. the old wholesale_min_qty rule is unchanged
 *   7. a configured price of zero is honoured, not treated as missing
 *
 * Run:  node --experimental-strip-types unit_price_lists.js
 */

// Plain JavaScript on purpose: --experimental-strip-types only strips .ts
// modules, so a .js test cannot carry type annotations of its own even though it
// imports a .ts file. resolvePrice is pure, so it needs nothing but the value.
import { resolvePrice } from '../src/lib/pricing.ts';

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
const eq = (a, b, m) => assert(a === b, (m || 'value') + ': expected ' + b + ', got ' + a);

const P = 1; // any product id

console.log('\nPrice resolution (spec 27 / 220)');

// The three original tier columns, exactly as products holds them.
const tierProduct = {
  price_walking: 5000,
  price_returning: 4800,
  price_wholesale: 4500,
  wholesale_min_qty: 10,
};

await check('legacy tiers still resolve exactly as before', () => {
  eq(resolvePrice(P, 'walking', 1, { product: tierProduct }).price, 5000, 'walking');
  eq(resolvePrice(P, 'returning', 1, { product: tierProduct }).price, 4800, 'returning');
  eq(resolvePrice(P, 'wholesale', 10, { product: tierProduct }).price, 4500, 'wholesale at threshold');
  eq(resolvePrice(P, 'wholesale', 9, { product: tierProduct }).price, 4800,
    'below the wholesale threshold it must fall back to returning');
});

await check('walking falls back to returning when walking is unset', () => {
  // products.price_walking is nullable, and pf() fell back when it was null.
  const r = resolvePrice(P, 'walking', 1, { product: { ...tierProduct, price_walking: null } });
  eq(r.price, 4800, 'null walking price');
  eq(r.source, 'tier', 'source');
});

await check('a list price beats the legacy columns', () => {
  const r = resolvePrice(P, 'returning', 1, {
    product: tierProduct,
    listItems: [{ product_id: P, price: 4600, min_qty: null }],
  });
  eq(r.price, 4600, 'list price');
  eq(r.source, 'assigned_list', 'source');
});

await check('an individually agreed price beats everything', () => {
  // "Zafar gets 3,800 for the GTX" - the most personal answer given, so the
  // one a shopkeeper expects to win.
  const r = resolvePrice(P, 'walking', 1, {
    product: tierProduct,
    listItems: [{ product_id: P, price: 4600, min_qty: null }],
    partyPrices: { [P]: 3800 },
  });
  eq(r.price, 3800, 'agreed price');
  eq(r.source, 'party', 'source');
});

await check('a quantity break applies AT and ABOVE its threshold', () => {
  const src = {
    listItems: [
      { product_id: P, price: 4600, min_qty: null },   // any quantity
      { product_id: P, price: 4200, min_qty: 10 },      // 10 or more
    ],
  };
  eq(resolvePrice(P, 'returning', 1, src).price, 4600, 'one unit');
  eq(resolvePrice(P, 'returning', 9, src).price, 4600, 'nine units');
  eq(resolvePrice(P, 'returning', 10, src).price, 4200, 'exactly ten');
  eq(resolvePrice(P, 'returning', 25, src).price, 4200, 'twenty five');
});

await check('the highest REACHED break wins, and an unreached one is ignored', () => {
  // The bug this guards: pricing a single unit at the bulk rate by falling back
  // to the largest break the quantity did NOT reach.
  const src = {
    listItems: [
      { product_id: P, price: 4000, min_qty: 50 },
      { product_id: P, price: 4200, min_qty: 10 },
      { product_id: P, price: 4600, min_qty: null },
    ],
  };
  eq(resolvePrice(P, 'returning', 1, src).price, 4600, 'one unit must not get the 50+ price');
  eq(resolvePrice(P, 'returning', 12, src).price, 4200, 'twelve units');
  eq(resolvePrice(P, 'returning', 60, src).price, 4000, 'sixty units');
});

await check('a break row with no price is ignored rather than zeroed', () => {
  // price is nullable on purpose: a row can reserve a break without pricing it.
  const src = {
    listItems: [
      { product_id: P, price: null, min_qty: 5 },
      { product_id: P, price: 4600, min_qty: null },
    ],
  };
  eq(resolvePrice(P, 'returning', 10, src).price, 4600, 'must not resolve to 0');
});

await check('rows for a different product never leak in', () => {
  const src = {
    listItems: [
      { product_id: 99, price: 100, min_qty: null },
      { product_id: P, price: 4600, min_qty: null },
    ],
  };
  eq(resolvePrice(P, 'returning', 1, src).price, 4600, 'wrong product priced');
});

await check('nothing configured reports zero rather than throwing', () => {
  const r = resolvePrice(P, 'returning', 1, {});
  eq(r.price, 0, 'no price anywhere');
  eq(r.source, 'none', 'source');
});

await check('an agreed price of zero is honoured, not treated as missing', () => {
  // A free-of-charge item is a real thing, and a `|| 0` style fallback or a
  // truthiness check would swallow it and fall through to the list price.
  const r = resolvePrice(P, 'returning', 1, { partyPrices: { [P]: 0 } });
  eq(r.price, 0, 'free item');
  eq(r.source, 'party', 'source');
});

await check('fractional quantities resolve against the break correctly', () => {
  // Oil is sold by the litre, so the break must work on 9.5 vs 10, not round.
  const src = {
    listItems: [
      { product_id: P, price: 4600, min_qty: null },
      { product_id: P, price: 4200, min_qty: 10 },
    ],
  };
  eq(resolvePrice(P, 'returning', 9.99, src).price, 4600, '9.99 litres');
  eq(resolvePrice(P, 'returning', 10, src).price, 4200, '10 litres');
});

// ── the group layer (migration 031) ────────────────────────────────────────
// "the returning, wholesale or walkin, pricing should follow this as priority on
// top of normal price" - so a group sits ABOVE the normal price and BELOW a
// price agreed with one named customer.

await check('a group beats the normal price', () => {
  // Wholesale group, walking switcher. The group must win, or the W/R/Wh
  // buttons still override the customer they were supposed to describe.
  const r = resolvePrice(P, 'walking', 1, {
    product: tierProduct,
    groupTier: 'wholesale',
  });
  eq(r.price, 4800, 'group tier should bill returning, not walking');
  eq(r.source, 'group_tier', 'source');
});

await check("a group's list beats the normal price and honours its breaks", () => {
  const r = resolvePrice(P, 'walking', 12, {
    product: tierProduct,
    groupTier: 'wholesale',
    groupListItems: [
      { product_id: P, price: 4300, min_qty: null },
      { product_id: P, price: 4000, min_qty: 10 },
    ],
  });
  eq(r.price, 4000, 'twelve units should take the group bulk price');
  eq(r.source, 'group_list', 'source');
  eq(resolvePrice(P, 'walking', 3, {
    product: tierProduct, groupTier: 'wholesale',
    groupListItems: [{ product_id: P, price: 4300, min_qty: null }],
  }).price, 4300, 'three units should take the group list price');
});

await check('an agreed price still beats the group', () => {
  // The ladder must not be a flat "group wins". The most personal answer
  // given is still the most personal.
  const r = resolvePrice(P, 'walking', 1, {
    product: tierProduct,
    groupTier: 'wholesale',
    groupListItems: [{ product_id: P, price: 4300, min_qty: null }],
    partyPrices: { [P]: 3800 },
  });
  eq(r.price, 3800, 'agreed price');
  eq(r.source, 'party', 'source');
});

await check('a directly assigned list beats the group list', () => {
  // Individual beats group: a one-off arrangement is more personal than the
  // group rule it sits inside.
  const r = resolvePrice(P, 'wholesale', 1, {
    product: tierProduct,
    listItems: [{ product_id: P, price: 4100, min_qty: null }],
    groupListItems: [{ product_id: P, price: 4300, min_qty: null }],
    groupTier: 'wholesale',
  });
  eq(r.price, 4100, 'assigned list');
  eq(r.source, 'assigned_list', 'source');
});

await check('a group with no list still prices by its tier', () => {
  // The common case: a group that just means "bill them wholesale", reusing the
  // product's own tier columns rather than copying prices into the group.
  const r = resolvePrice(P, 'walking', 10, {
    product: tierProduct,
    groupTier: 'wholesale',
  });
  eq(r.price, 4500, 'ten units of wholesale');
  eq(resolvePrice(P, 'walking', 2, { product: tierProduct, groupTier: 'wholesale' }).price,
     4800, 'below the wholesale threshold it still falls back to returning');
});

await check('a group on a product it has no list entry for falls through cleanly', () => {
  const r = resolvePrice(P, 'walking', 1, {
    product: tierProduct,
    groupTier: 'wholesale',
    groupListItems: [{ product_id: 99, price: 1111, min_qty: null }],
  });
  eq(r.price, 4800, 'must not price from another product');
  eq(r.source, 'group_tier', 'should fall through to the group tier');
});

await check('a customer with no group behaves exactly as before', () => {
  // The whole change must be invisible to anyone not in a group.
  const r = resolvePrice(P, 'returning', 1, { product: tierProduct });
  eq(r.price, 4800, 'price');
  eq(r.source, 'tier', 'source');
});

console.log('\n' + ok + '/' + total + ' checks passed');
process.exit(ok === total ? 0 : 1);
