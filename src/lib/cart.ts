import type { Product, CustomerType, CartItem } from "./types.ts";
import { resolvePrice, type PriceSource } from "./pricing.ts";
import { packLitres } from "./units.ts";

export type { CartItem };

// Moved out of src/modules/pos/POSCart.tsx so the cart has a test: the
// helpers had NO test while they lived in that .tsx file (node's type
// stripper cannot import .tsx), which is how two real bugs survived —
// addContainer's second tap drew a whole litre past what the bottle held,
// and addProduct let a line grow past the stock on the shelf. POSCart.tsx
// re-exports everything here, so its import sites are untouched.

/**
 * How much oil is left in the bottle: pack size minus what the engine took.
 * A 4L bottle into a 3.5L engine leaves 0.5L. Returns 0 when the capacity is
 * unknown, or when it meets/exceeds the pack (customer keeps the whole bottle).
 */
export function leftoverLitres(item: CartItem): number {
  const pack = packLitres(item.product);
  const cap = item.capacity ?? 0;
  if (pack <= 0 || cap <= 0 || cap >= pack) return 0;
  return Math.round((pack - cap) * 1000) / 1000;
}

/**
 * Price for one line, before any capacity pro-rating.
 *
 * This used to be `pf()`, a second copy of the tier rules that already lived in
 * POSSearch.tsx. Two copies of a pricing rule is how a customer gets quoted one
 * number in the search results and charged another in the cart, so the rule now
 * lives once in src/lib/pricing.ts and both screens call it.
 *
 * `ctx` is the customer's price context (their price list and any individually
 * agreed prices). It is optional and defaults to empty, which resolves through
 * the product's own tier columns exactly as before - that fallback is what lets
 * this ship without changing a single price the shop already charges.
 */
export function tierPrice(
  p: Product,
  ct: CustomerType,
  qty: number,
  ctx: PriceSource = {}
): number {
  return resolvePrice(p.id, ct, qty, { ...ctx, product: p }).price || 0;
}

/**
 * Price for a single line, honouring the "bill by capacity" switch.
 *
 * A 4L bottle at 4000 poured into a 3.5L engine is billed 3.5/4 x 4000 = 3500
 * when the switch is on. With it off (or no capacity recorded, or the capacity
 * meeting/exceeding the pack) the full bottle price applies.
 */
export function effectiveUnitPrice(item: CartItem, tierPrice: number): number {
  if (item.kind !== "product" || !item.billByCapacity) return tierPrice;
  const pack = packLitres(item.product);
  const cap = item.capacity ?? 0;
  if (pack <= 0 || cap <= 0 || cap >= pack) return tierPrice;
  return Math.round(tierPrice * (cap / pack) * 100) / 100; // paisa-safe
}

/** Re-price a single line from its product + tier, applying capacity pro-rating. */
function reprice(item: CartItem, ct: CustomerType, ctx: PriceSource): CartItem {
  if (item.kind !== "product" || !item.product) return item;
  const u = effectiveUnitPrice(item, tierPrice(item.product, ct, item.qty, ctx));
  return { ...item, unit_price: u, line_total: u * item.qty };
}

/**
 * Re-price every product line.
 *
 * Called whenever the answer could have changed: the tier switched, a customer
 * was chosen, or a capacity was entered. All three change what an item costs,
 * so all three route through here rather than each nudging prices itself.
 */
export function repriceAll(cart: CartItem[], ct: CustomerType, ctx: PriceSource = {}): CartItem[] {
  return cart.map((x) => reprice(x, ct, ctx));
}

/**
 * How many units of this product the cart may hold: the stock on the shelf.
 * The local column is REAL DEFAULT 0, so a product with no recorded stock
 * reads 0 — and Number(null) === 0, which is the same answer: nothing on
 * hand, nothing to sell. Only a genuinely unknown (non-finite, non-null)
 * figure is uncapped; that cannot come from the database, it is defensive.
 * A negative figure (damage from before the batch-8 repair) caps at zero.
 */
function stockCap(p: Product): number {
  const raw = (p as { stock_qty?: unknown }).stock_qty;
  if (raw === undefined || raw === "") return Infinity;
  const s = Number(raw);
  return Number.isFinite(s) ? Math.max(0, s) : Infinity;
}

export function addProduct(
  cart: CartItem[],
  p: Product,
  ct: CustomerType,
  products: Product[],
  ctx: PriceSource = {}
): CartItem[] {
  const cap = stockCap(p);
  const ex = cart.find((x) => x.kind === "product" && x.ref_id === p.id);
  if (ex) return cart.map((x) => {
    if (x !== ex) return x;
    // Never past what the shelf holds: the old code added one more bottle
    // on every tap with no ceiling, so a finished product could be sold
    // until its stock read -2 (reported 2026-11-25). At the cap, tapping
    // again adds nothing — the line visibly stops growing.
    const nq = Math.min(x.qty + 1, cap);
    if (nq === x.qty) return x;
    const u = effectiveUnitPrice(x, tierPrice(p, ct, nq, ctx));
    return { ...x, qty: nq, unit_price: u, line_total: u * nq };
  });
  // Nothing left to sell: no line is added at all. POS shows the reason
  // (its out-of-stock check runs before this call); a bare refusal here
  // would leave the operator tapping with no explanation.
  if (!(cap > 0)) return cart;
  const fresh: CartItem = {
    id: `p-${p.id}-${Date.now()}`, kind: "product", ref_id: p.id, name: p.name,
    qty: 1, unit_price: 0, line_total: 0, product: p,
    // Defaults: charged for what the engine takes, remainder back on the shelf.
    billByCapacity: true, leftoverToContainers: true,
    // The ceiling travels with the line so a typed quantity (updateQty)
    // clamps to it too. The sale re-checks live stock before committing,
    // so a stale figure here can never oversell — only under-add.
    max_qty: Number.isFinite(cap) ? cap : undefined,
  };
  const u = effectiveUnitPrice(fresh, tierPrice(p, ct, 1, ctx));
  return [...cart, { ...fresh, unit_price: u, line_total: u }];
}

export function addService(cart: CartItem[], s: { id: number; name: string; price: number }): CartItem[] {
  const ex = cart.find((x) => x.kind === "service" && x.ref_id === s.id);
  if (ex) return cart.map((x) => x === ex ? { ...x, qty: x.qty + 1, line_total: x.unit_price * (x.qty + 1) } : x);
  return [...cart, { id: `s-${s.id}-${Date.now()}`, kind: "service", ref_id: s.id, name: s.name, qty: 1, unit_price: s.price, line_total: s.price }];
}

/**
 * Add a partial container (leftover oil) to the cart.
 *
 * A container line bills by the LITRE drawn, never by the bottle: `qty` is
 * litres, capped at the first litre (or the whole remainder when it is under
 * a litre), and `unitPrice` is the PER-LITRE price of this exact bottle.
 *
 * The per-litre price is resolved by the caller (POS.tsx) through
 * containerUnitPrice in src/lib/pricing.ts — the recorded sale for this
 * bottle first, else the product's own tier columns, never a negotiated
 * price — and passed in here, because resolving it here would throw inside
 * this setState updater when the bottle cannot be priced. The existing-line
 * branch re-uses the line's own unit_price, so a second tap only draws one
 * more litre (still capped at what is left) at the same per-litre price.
 */
export function addContainer(
  cart: CartItem[],
  c: any,
  unitPrice: number
): CartItem[] {
  const remaining = Math.max(0, Number(c.remaining_volume) || 0);
  const ex = cart.find((x) => x.kind === "partial_container" && x.container_id === c.id);
  if (ex) return cart.map((x) => {
    if (x !== ex) return x;
    // One more litre, but never past what the bottle holds: the old code
    // added a whole litre whenever qty < remaining, so a 1.2L bottle went
    // to 2.0L in the cart and the sale drove it to -0.8 (the -0.5L row
    // reported 2026-11-25 came from exactly this over-draw).
    const nq = Math.min(x.qty + 1, remaining);
    if (nq === x.qty) return x;
    return { ...x, qty: nq, line_total: x.unit_price * nq };
  });
  // Start at one litre — or the whole remainder when it is under a litre.
  // The old code always started at qty 1, which on a 0.5L container drew
  // half a litre more than the bottle holds (remaining went to -0.5).
  const qty = Math.min(1, remaining);
  if (!(qty > 0)) return cart;
  return [...cart, { id: `c-${c.id}-${Date.now()}`, kind: "partial_container", ref_id: c.id, name: `${c.product_name} (${c.remaining_volume.toFixed(1)}L left)`, qty, unit_price: unitPrice, line_total: Math.round(unitPrice * qty * 100) / 100, container_id: c.id, max_qty: remaining }];
}

export function updateQty(
  cart: CartItem[],
  id: string,
  qty: number,
  ct: CustomerType,
  ctx: PriceSource = {}
): CartItem[] {
  return cart.map((x) => {
    if (x.id !== id) return x;
    const max = x.max_qty ?? 9999;
    const nq = Math.max(0, Math.min(qty, max));
    if (nq === 0) return x;
    if (x.kind === "product" && x.product) {
      const u = effectiveUnitPrice(x, tierPrice(x.product, ct, nq, ctx));
      return { ...x, qty: nq, unit_price: u, line_total: u * nq };
    }
    return { ...x, qty: nq, line_total: x.unit_price * nq };
  }).filter((x) => x.qty > 0);
}

export function updatePrice(cart: CartItem[], id: string, price: number): CartItem[] {
  return cart.map((x) => x.id === id ? { ...x, unit_price: price, line_total: price * x.qty } : x);
}

/**
 * Set the engine oil capacity on a line and re-price it.
 * The capacity drives both the pro-rated price and the leftover volume.
 */
export function updateCapacity(cart: CartItem[], id: string, litres: number, ct: CustomerType): CartItem[] {
  return repriceAll(cart.map((x) => (x.id === id ? { ...x, capacity: litres } : x)), ct);
}

/**
 * Turn capacity-based billing on/off for a line.
 * Turning it on also sends the unused oil back to the containers shelf, so the
 * switch defaults behave the way the shop expects; the operator can override
 * the leftover destination afterwards.
 */
export function toggleBillByCapacity(cart: CartItem[], id: string, on: boolean, ct: CustomerType): CartItem[] {
  return repriceAll(cart.map((x) => (x.id === id ? { ...x, billByCapacity: on, leftoverToContainers: on } : x)), ct);
}

/** Choose where the unused oil goes: back on the shelf, or home with the customer. */
export function toggleLeftoverToContainers(cart: CartItem[], id: string, toContainers: boolean): CartItem[] {
  return cart.map((x) => (x.id === id ? { ...x, leftoverToContainers: toContainers } : x));
}

// ── Sale-time stock guard ──────────────────────────────────────────────────

export interface StockAvailability {
  /** Display name, for the error message. */
  name: string;
  /** Units on hand. */
  qty: number;
}

export interface ContainerAvailability {
  /** Product name of the bottle, for the error message. */
  name: string;
  /** Litres left in the bottle. */
  remaining: number;
}

/** A line shape the guard understands — CartItem satisfies it, as do the
 * net-out deltas an edit produces (see saveOrderEdits). */
export interface GuardLine {
  kind: string;
  ref_id: number;
  name: string;
  qty: number;
  container_id?: number | null;
}

function fmtQty(n: number): string {
  const r = Math.round(n * 1000) / 1000;
  return Number.isInteger(r) ? String(r) : String(r);
}

/**
 * The sale must never take more than the shop has.
 *
 * Pure: the caller supplies the availability snapshot — completeSale reads
 * it live from the database first, so the check sees the stock as it stands
 * at the moment of the sale, not the figure the cart was built with. Lines
 * of the same product are summed (the cart merges them, but a defence that
 * trusts the merge is a defence with a hole in it); lines of the same
 * container likewise. Unknown stock (a product or container missing from
 * the snapshot) counts as zero on hand — a line for something that does
 * not exist cannot be sold.
 *
 * Returns a clear, operator-readable error naming the product and the
 * amount available, or null when the cart fits the stock on hand. The
 * caller throws the message, so the operator sees it in the error banner
 * and nothing is written.
 */
export function validateSaleStock(
  cart: GuardLine[],
  stockById: Map<number, StockAvailability>,
  containersById: Map<number, ContainerAvailability>
): string | null {
  const EPS = 1e-9;
  const needProduct = new Map<number, number>();
  const needContainer = new Map<number, number>();
  for (const item of cart) {
    if (!(item.qty > 0)) continue;
    if (item.kind === "product") {
      needProduct.set(item.ref_id, (needProduct.get(item.ref_id) ?? 0) + item.qty);
    } else if (item.kind === "partial_container" && item.container_id) {
      needContainer.set(item.container_id, (needContainer.get(item.container_id) ?? 0) + item.qty);
    }
  }
  for (const [pid, need] of needProduct) {
    const have = stockById.get(pid);
    const onHand = have ? Number(have.qty) || 0 : 0;
    if (need > onHand + EPS) {
      const name = have?.name ?? `product #${pid}`;
      return `Not enough stock for ${name} — only ${fmtQty(onHand)} left, this sale needs ${fmtQty(need)}.`;
    }
  }
  for (const [cid, need] of needContainer) {
    const have = containersById.get(cid);
    const left = have ? Number(have.remaining) || 0 : 0;
    if (need > left + EPS) {
      const name = have?.name ?? `container #${cid}`;
      return `Not enough leftover in the ${name} container — only ${fmtQty(left)}L left, this sale needs ${fmtQty(need)}L.`;
    }
  }
  return null;
}
