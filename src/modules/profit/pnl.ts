/**
 * Profit & Loss maths.
 *
 * Deliberately free of React and of the database: the page hands in raw
 * aggregate rows and gets back every line of the statement, so the arithmetic
 * can be checked on its own.
 *
 * Two lines are structural zeros until the schema carries them — `orders` has no
 * discount column and `services` has no cost column — but they are modelled here
 * anyway so the totals stay correct the moment those columns appear.
 */

export type PeriodKey = "today" | "week" | "month" | "year" | "all" | "custom";

export interface Period {
  from: string;
  to: string;
}

/** Chip row: full label on desktop, `short` on narrow screens. */
export const PERIODS: { key: PeriodKey; label: string; short: string }[] = [
  { key: "today", label: "Today", short: "Today" },
  { key: "week", label: "This Week", short: "Week" },
  { key: "month", label: "This Month", short: "Month" },
  { key: "year", label: "This Year", short: "Year" },
  { key: "all", label: "All Time", short: "All" },
  { key: "custom", label: "Custom Range", short: "Range" },
];

// Sentinels so "All Time" reuses the same BETWEEN clause as every other period.
const MIN_DATE = "1900-01-01";
const MAX_DATE = "2999-12-31";

function iso(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Inclusive [from, to] window for a preset, or the supplied custom window. */
export function periodRange(key: PeriodKey, custom?: Partial<Period>): Period {
  const now = new Date();
  const to = iso(now);

  switch (key) {
    case "today":
      return { from: to, to };
    case "week": {
      const d = new Date(now);
      d.setDate(d.getDate() - 6); // rolling 7 days, matching the dashboard
      return { from: iso(d), to };
    }
    case "month":
      return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to };
    case "year":
      return { from: iso(new Date(now.getFullYear(), 0, 1)), to };
    case "custom":
      return { from: custom?.from || MIN_DATE, to: custom?.to || to };
    case "all":
    default:
      return { from: MIN_DATE, to: MAX_DATE };
  }
}

/** Raw rows the page fetches. */
export interface KindRow {
  kind: string;
  sales: number;
  cost: number;
}

export interface PnlInput {
  /** One row per order-item kind ('product' | 'service'). */
  kindRows: KindRow[];
  /** Completed bills in range. */
  totalSales: number;
  /** Voided / cancelled bills in range. */
  refunds: number;
  /** No column exists yet — always 0 until discounts are captured in the POS. */
  discounts?: number;
  /** Running costs from the expenses ledger. */
  expenses: number;
}

export interface Pnl {
  totalSales: number;
  discounts: number;
  refunds: number;
  netSales: number;
  productSales: number;
  productCost: number;
  serviceSales: number;
  serviceCost: number;
  grossProfit: number;
  grossMargin: number | null;
  shopExpenses: number;
  netProfit: number;
  netMargin: number | null;
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Percent (one decimal place), or null when there is no revenue to divide by. */
export function margin(part: number, base: number): number | null {
  if (!base) return null;
  return (part / base) * 100;
}

/** "20.2%" — or an em dash when the base was zero, matching the design. */
export function pct(m: number | null): string {
  return m == null ? "—" : `${m.toFixed(1)}%`;
}

export function computePnl(input: PnlInput): Pnl {
  const totalSales = num(input.totalSales);
  const discounts = num(input.discounts);
  const refunds = num(input.refunds);
  const shopExpenses = num(input.expenses);

  const product = (input.kindRows ?? []).find((r) => r.kind === "product");
  const service = (input.kindRows ?? []).find((r) => r.kind === "service");
  const productSales = num(product?.sales);
  const productCost = num(product?.cost);
  const serviceSales = num(service?.sales);
  const serviceCost = num(service?.cost);

  const netSales = totalSales - discounts - refunds;
  const grossProfit = netSales - productCost - serviceCost;
  const netProfit = grossProfit - shopExpenses;

  return {
    totalSales,
    discounts,
    refunds,
    netSales,
    productSales,
    productCost,
    serviceSales,
    serviceCost,
    grossProfit,
    grossMargin: margin(grossProfit, netSales),
    shopExpenses,
    netProfit,
    netMargin: margin(netProfit, netSales),
  };
}
