import type { Product } from "./types";

/**
 * How big is this pack, in litres?
 *
 * This drives the "bill 3.5L of a 4L bottle" pro-rating and the leftover that
 * goes back on the shelf - so it decides real money. It lived as a regex
 * inside POSCart.tsx with no test at all, which is why a genuine bug went
 * unnoticed: see `isVolumePack` below.
 *
 * Extracted here so it can be tested. The POS re-exports it, so every existing
 * call site is unchanged.
 */
export function packLitres(p?: Product | null): number {
  const raw = String((p as any)?.packing ?? "").trim().toLowerCase();
  // Reject a negative pack before parsing. The strip below removes every
  // non-digit, including the minus, so "-4L" would otherwise parse as 4 LITRES
  // and pro-rate against a negative pack size. Found by the test written to
  // lock this function down - which is the entire reason for extracting it.
  if (raw.includes("-")) return 0;
  const n = parseFloat(raw.replace(/[^\d.]/g, ""));
  if (!isFinite(n) || n <= 0) return 0;
  return /ml/.test(raw) ? n / 1000 : n; // 500ml -> 0.5L
}

/**
 * Does this pack have a volume at all?
 *
 * The bug this exists to name: the original regex stripped every non-digit, so
 * "1kg" parsed to 1 and - because it contains no "ml" - was reported as ONE
 * LITRE. A 1kg tub of grease was therefore treated as a 1 litre pack and
 * compared against a car's oil capacity in litres, which is comparing a weight
 * with a volume. Same for "1pc": a filter has no litres at all, and reporting 1
 * made it look like a litre-sized pack.
 *
 * Harmless today only by accident: grease and filters are not poured into an
 * engine, so the pro-rating never got the chance to misbehave visibly. That is
 * luck, not correctness, and the next pack type added would have found it.
 */
export function isVolumePack(p?: Product | null): boolean {
  const raw = String((p as any)?.packing ?? "").trim().toLowerCase();
  // Must carry a volume unit, and must NOT be a weight or a count.
  if (/(kg|g\b|gm|gram)/.test(raw)) return false;
  if (/(pc|pcs|piece|nos?\.?)/.test(raw)) return false;
  return /\d\s*(l\b|ltr|litre|liter|ml\b)/.test(raw);
}

/**
 * How many decimal places a quantity in this unit can sensibly carry.
 *
 * Spec §238 makes this configurable. Oil sold by the litre needs 4.5 to be
 * enterable; a filter has no meaningful half of one. The default is 0 for
 * anything that is not a liquid, which is the safer default - a count with
 * silent decimals is how a stock figure starts disagreeing with the shelf.
 */
export function quantityDecimals(p?: Product | null): number {
  return isVolumePack(p) ? 2 : 0;
}
