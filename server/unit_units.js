/**
 * Unit tests for pack sizes and quantity precision (spec §25 unit, §238
 * quantity precision).
 *
 * packLitres() decides real money: it drives the "bill 3.5L of a 4L bottle"
 * pro-rating and the leftover returned to the shelf. It had NO test while it
 * lived inside POSCart.tsx, and the first thing these tests did was find a real
 * bug in it - see the "1kg" case.
 *
 * Run:  node --experimental-strip-types unit_units.js
 */

import { packLitres, isVolumePack, quantityDecimals } from '../src/lib/units.ts';

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

/** A product carrying only a packing label, which is all these care about. */
const pack = (packing) => ({ packing });

console.log('\nPack sizes and quantity precision (spec 25 / 238)');

await check('liquid packs parse to litres', () => {
  eq(packLitres(pack('4L')), 4, '4L');
  eq(packLitres(pack('1L')), 1, '1L');
  eq(packLitres(pack('5L')), 5, '5L');
  eq(packLitres(pack('20L')), 20, '20L drum');
  eq(packLitres(pack(' 4l ')), 4, 'whitespace and lower case');
});

await check('millilitres convert to litres', () => {
  eq(packLitres(pack('500ml')), 0.5, '500ml');
  eq(packLitres(pack('250ml')), 0.25, '250ml');
  eq(packLitres(pack('1L')), 1, '1L is not a millilitre');
});

await check('the shop\'s real catalog parses correctly', () => {
  // Exactly the packing labels in the database today, so a regression here is
  // a regression in the shop, not in a contrived example.
  const real = { '4L': 4, '1L': 1, '5L': 5, '20L': 20, '500ml': 0.5, '1L': 1 };
  for (const [label, litres] of Object.entries(real)) {
    eq(packLitres(pack(label)), litres, label);
  }
});

await check('missing or unparseable packs are zero, never NaN', () => {
  // Zero is the safe answer: it disables pro-rating, so the full bottle price
  // applies. NaN would poison every total on the screen.
  eq(packLitres(null), 0, 'null');
  eq(packLitres(undefined), 0, 'undefined');
  eq(packLitres({}), 0, 'no packing at all');
  eq(packLitres(pack('')), 0, 'empty string');
  eq(packLitres(pack('abc')), 0, 'junk');
  eq(packLitres(pack('0L')), 0, 'zero litres');
  eq(packLitres(pack('-4L')), 0, 'negative');
});

await check('a WEIGHT is not a volume, and is not treated as one', () => {
  // THE BUG. The original stripped every non-digit, so "1kg" parsed to 1 and,
  // having no "ml", was reported as ONE LITRE - a weight compared against an
  // engine's oil capacity in litres. Harmless by accident: grease is not poured
  // into an engine, so it never got the chance to misbehave visibly.
  eq(isVolumePack(pack('1kg')), false, '1kg is not a volume');
  eq(isVolumePack(pack('500g')), false, '500g is not a volume');
  eq(isVolumePack(pack('4L')), true, '4L is a volume');
  eq(isVolumePack(pack('500ml')), true, '500ml is a volume');
});

await check('a COUNT is not a volume either', () => {
  // "1pc" previously parsed to 1 and looked like a 1 litre pack. A filter has no
  // litres at all, and reporting 1 made it look litre-sized.
  eq(isVolumePack(pack('1pc')), false, '1pc is not a volume');
  eq(isVolumePack(pack('2 pcs')), false, '2 pcs is not a volume');
  eq(isVolumePack(pack('4L')), true, '4L is a volume');
});

await check('liquids accept decimals, counts do not', () => {
  // Spec §238, made concrete. Oil must be enterable as 4.5; a filter with a
  // silent half is how a stock figure starts disagreeing with the shelf.
  eq(quantityDecimals(pack('4L')), 2, 'litres');
  eq(quantityDecimals(pack('500ml')), 2, 'millilitres');
  eq(quantityDecimals(pack('1kg')), 0, 'weight');
  eq(quantityDecimals(pack('1pc')), 0, 'count');
});

await check('an unknown pack is treated as a count, not a liquid', () => {
  // The safe default: no decimals. A count with silent decimals is worse than
  // a liquid that needs one typed.
  eq(quantityDecimals(pack('mystery')), 0, 'unknown pack');
  eq(quantityDecimals(null), 0, 'no product');
});

console.log('\n' + ok + '/' + total + ' checks passed');
process.exit(ok === total ? 0 : 1);
