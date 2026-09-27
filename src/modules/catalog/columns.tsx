import type { ReactNode } from "react";
import { currency, d, dt } from "../../lib/format";
import type { EntityKey } from "./prefs";

export interface Column {
  key: string;
  label: string;
  align?: "left" | "right" | "center";
  /** Included when the user has not customised the set. */
  defaultOn?: boolean;
  /** Also render this field on the thumbnail card. */
  card?: boolean;
  /** Cell value for list mode. */
  render: (row: any) => ReactNode;
}

const txt = (v: any) => (v === null || v === undefined || v === "" ? "—" : String(v));
const num = (v: any) => (v === null || v === undefined ? "—" : v);

function activeBadge(v: any) {
  return (
    <span className={`badge ${v ? "badge-green" : "badge-gray"}`}>{v ? "Active" : "Inactive"}</span>
  );
}

function statusBadge(s: string) {
  const cls = s === "full" ? "badge-green" : s === "opened" ? "badge-yellow" : "badge-gray";
  return <span className={`badge ${cls}`}>{s}</span>;
}

const OIL_TYPE: Record<string, string> = {
  added: "Added (sale)",
  collected: "Collected",
  removed: "Removed",
  disposed: "Disposed",
};

export const COLUMNS: Record<EntityKey, Column[]> = {
  products: [
    { key: "name", label: "Product", defaultOn: true, card: true, render: (r) => r.name },
    { key: "brand_name", label: "Company", defaultOn: true, card: true, render: (r) => txt(r.brand_name) },
    { key: "vendor_name", label: "Supplier", defaultOn: true, card: true, render: (r) => txt(r.vendor_name) },
    { key: "category_name", label: "Category", render: (r) => txt(r.category_name) },
    { key: "packing", label: "Packing", defaultOn: true, card: true, render: (r) => txt(r.packing) },
    { key: "stock_qty", label: "Stock", align: "right", defaultOn: true, card: true, render: (r) => num(r.stock_qty) },
    { key: "price_returning", label: "Returning", align: "right", defaultOn: true, card: true, render: (r) => currency(r.price_returning) },
    { key: "price_walking", label: "Walk-in", align: "right", render: (r) => (r.price_walking == null ? "—" : currency(r.price_walking)) },
    { key: "price_wholesale", label: "Wholesale", align: "right", render: (r) => currency(r.price_wholesale) },
    { key: "wholesale_min_qty", label: "Min qty", align: "right", render: (r) => num(r.wholesale_min_qty) },
    { key: "cost_price", label: "Cost", align: "right", render: (r) => currency(r.cost_price) },
    { key: "exp_date", label: "Expiry", defaultOn: true, card: true, render: (r) => (r.exp_date ? d(r.exp_date) : "—") },
    { key: "received_date", label: "Received", defaultOn: true, card: true, render: (r) => (r.received_date ? d(r.received_date) : "—") },
    { key: "mfd_date", label: "Mfg date", render: (r) => (r.mfd_date ? d(r.mfd_date) : "—") },
    { key: "sku", label: "SKU", render: (r) => txt(r.sku) },
    { key: "barcode", label: "Barcode", render: (r) => txt(r.barcode) },
    { key: "unit", label: "Unit", render: (r) => txt(r.unit) },
    { key: "variant", label: "Variant", render: (r) => txt(r.variant) },
    { key: "low_stock_threshold", label: "Low stock", align: "right", render: (r) => num(r.low_stock_threshold) },
    { key: "offer", label: "Offer", render: (r) => txt(r.offer) },
    { key: "created_at", label: "Added", render: (r) => (r.created_at ? dt(r.created_at) : "—") },
    { key: "active", label: "Status", render: (r) => activeBadge(r.active) },
  ],
  services: [
    { key: "name", label: "Service", defaultOn: true, card: true, render: (r) => r.name },
    { key: "price", label: "Price", align: "right", defaultOn: true, card: true, render: (r) => currency(r.price) },
    { key: "active", label: "Status", defaultOn: true, card: true, render: (r) => activeBadge(r.active) },
    { key: "created_at", label: "Added", render: (r) => (r.created_at ? dt(r.created_at) : "—") },
  ],
  containers: [
    { key: "product_name", label: "Product", defaultOn: true, card: true, render: (r) => r.product_name },
    { key: "status", label: "Status", defaultOn: true, card: true, render: (r) => statusBadge(r.status) },
    { key: "remaining_volume", label: "Remaining", align: "right", defaultOn: true, card: true, render: (r) => `${(r.remaining_volume ?? 0).toFixed(2)} L` },
    { key: "original_volume", label: "Original", align: "right", defaultOn: true, card: true, render: (r) => `${(r.original_volume ?? 0).toFixed(1)} L` },
    { key: "barcode", label: "Barcode", defaultOn: true, render: (r) => txt(r.barcode) },
    { key: "opened_at", label: "Opened", defaultOn: true, card: true, render: (r) => txt(r.opened_at) },
    { key: "source_order_id", label: "Source order", align: "right", render: (r) => (r.source_order_id ? `#${r.source_order_id}` : "—") },
  ],
  used_oil: [
    { key: "created_at", label: "When", defaultOn: true, card: true, render: (r) => (r.created_at ? dt(r.created_at) : "—") },
    { key: "type", label: "Type", defaultOn: true, card: true, render: (r) => OIL_TYPE[r.type] ?? txt(r.type) },
    { key: "litres", label: "Litres", align: "right", defaultOn: true, card: true, render: (r) => `${(r.litres ?? 0) > 0 ? "+" : ""}${(r.litres ?? 0).toFixed(1)} L` },
    { key: "notes", label: "Notes", defaultOn: true, card: true, render: (r) => txt(r.notes) },
    { key: "source_order_id", label: "Source order", align: "right", render: (r) => (r.source_order_id ? `#${r.source_order_id}` : "—") },
  ],
};

/** The columns that should be visible when the user has not customised the entity. */
export function defaultKeys(entity: EntityKey): string[] {
  return COLUMNS[entity].filter((c) => c.defaultOn).map((c) => c.key);
}

/** Resolve the stored selection (or defaults) into Column objects, in definition order. */
export function visibleColumns(entity: EntityKey, selected?: string[]): Column[] {
  const keys = selected ?? defaultKeys(entity);
  return COLUMNS[entity].filter((c) => keys.includes(c.key));
}

/**
 * Split the visible columns into a card title plus the remaining card fields.
 * The title always renders (a card needs a heading) even if that column has
 * been unchecked.
 */
export function cardParts(entity: EntityKey, visible: Column[]): { title: Column; cards: Column[] } {
  const all = COLUMNS[entity];
  const title = all.find((c) => c.card) ?? all[0];
  return { title, cards: visible.filter((c) => c.card && c.key !== title.key) };
}