import { useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { dbGet, dbSelect } from "../../lib/db";
import { currency } from "../../lib/format";
import { Page } from "../../components/Page";
import { PERIODS, computePnl, margin, pct, periodRange, type PeriodKey } from "./pnl";

// ── Palette (mirrors the tokens used across the other modules) ───────────────
const GREEN = "var(--color-success)";
const RED = "var(--color-danger)";
const INK = "#0f172a";
const BODY = "#475569";
const MUTED = "#64748b";
const FAINT = "#94a3b8";
const LINE = "#e2e8f0";
const SOFT = "#f8fafc";

const money = (n: number) => currency(n);
const TAB: CSSProperties = { fontVariantNumeric: "tabular-nums" };

/** Small uppercase caption that separates the statement's sections. */
function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div style={{ fontSize: "0.68rem", fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: FAINT, padding: "12px 0 4px" }}>
      {children}
    </div>
  );
}

/** One statement line: label + hint on the left, amount on the right. */
function Line({ label, hint, value, tone = "normal" }: { label: string; hint?: string; value: string; tone?: "normal" | "muted" | "strong" }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, padding: "9px 0", borderBottom: `1px solid ${SOFT}` }}>
      <div>
        <div style={{ fontSize: "0.85rem", color: tone === "strong" ? INK : MUTED, fontWeight: tone === "strong" ? 700 : 400 }}>{label}</div>
        {hint && <div style={{ fontSize: "0.72rem", color: FAINT, marginTop: 2 }}>{hint}</div>}
      </div>
      <div style={{ fontSize: "0.85rem", fontWeight: 700, whiteSpace: "nowrap", color: tone === "muted" ? "#cbd5e1" : tone === "strong" ? INK : BODY, ...TAB }}>
        {value}
      </div>
    </div>
  );
}

/** Boxed sub-total, used for Net Sales and Gross Profit. */
function TotalBox({ label, hint, value, sub }: { label: string; hint: string; value: string; sub?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, background: SOFT, border: `1px solid ${LINE}`, borderRadius: 12, padding: "12px 16px", margin: "8px 0" }}>
      <div>
        <div style={{ fontSize: "0.85rem", fontWeight: 700, color: INK }}>{label}</div>
        <div style={{ fontSize: "0.72rem", color: FAINT, marginTop: 2 }}>{hint}</div>
      </div>
      <div style={{ textAlign: "right" }}>
        <div style={{ fontSize: "1.05rem", fontWeight: 800, color: GREEN, ...TAB }}>{value}</div>
        {sub && <div style={{ fontSize: "0.72rem", fontWeight: 600, color: MUTED, marginTop: 2, ...TAB }}>{sub}</div>}
      </div>
    </div>
  );
}

/** Icon tile + heading shared by the two breakdown cards. */
function CardHead({ icon, title, subtitle }: { icon: string; title: string; subtitle: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <div style={{ width: 40, height: 40, borderRadius: 12, background: "#eff6ff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.05rem", flexShrink: 0 }}>
        {icon}
      </div>
      <div>
        <div style={{ fontSize: "0.9rem", fontWeight: 700, color: "#1e293b" }}>{title}</div>
        <div style={{ fontSize: "0.72rem", color: FAINT, marginTop: 2 }}>{subtitle}</div>
      </div>
    </div>
  );
}

/** One of the four headline cards. */
function Kpi({ label, value, hint, pill, pillValue, accent }: {
  label: string; value: string; hint: string; pill: string; pillValue: string; accent?: "green" | "red";
}) {
  const color = accent === "green" ? GREEN : accent === "red" ? RED : INK;
  const border = accent === "green" ? "#bbf7d0" : accent === "red" ? "#fecaca" : LINE;
  return (
    <div className="stat-card" style={{ borderColor: border, display: "flex", flexDirection: "column" }}>
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={{ color, ...TAB }}>{value}</div>
      <div className="stat-sub" style={{ color: FAINT, lineHeight: 1.45, flex: 1 }}>{hint}</div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, background: SOFT, borderRadius: 12, padding: "8px 12px", marginTop: 8 }}>
        <span style={{ fontSize: "0.68rem", fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: FAINT }}>{pill}</span>
        <span style={{ fontSize: "0.82rem", fontWeight: 700, color: "#334155", ...TAB }}>{pillValue}</span>
      </div>
    </div>
  );
}

/** Uppercase caption used above the small sub-total tiles. */
function Caption({ children, color }: { children: ReactNode; color?: string }) {
  return (
    <div style={{ fontSize: "0.68rem", fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: color ?? FAINT }}>
      {children}
    </div>
  );
}

export default function ProfitLoss() {
  const [period, setPeriod] = useState<PeriodKey>("all");
  const [custom, setCustom] = useState({ from: "", to: "" });
  const range = useMemo(() => periodRange(period, custom), [period, custom]);

  // Three statements on purpose. The API's SQL guard classifies a query by the
  // FIRST table it finds and switches the permission it demands as soon as
  // `expenses` is mentioned, so splitting keeps each requirement exact.
  const kinds = useQuery({
    queryKey: ["pnl", "kinds", range.from, range.to],
    queryFn: () =>
      dbSelect<{ kind: string; sales: number; cost: number }>(
        `SELECT oi.kind,
                COALESCE(SUM(oi.line_total), 0) AS sales,
                COALESCE(SUM(oi.qty * COALESCE(p.cost_price, 0)), 0) AS cost
         FROM orders o
         JOIN order_items oi ON oi.order_id = o.id
         LEFT JOIN products p ON p.id = oi.ref_id AND oi.kind = 'product'
         WHERE o.status = 'completed' AND o.created_at::date BETWEEN $1 AND $2
         GROUP BY oi.kind`,
        [range.from, range.to]
      ),
  });

  const sales = useQuery({
    queryKey: ["pnl", "sales", range.from, range.to],
    queryFn: () =>
      dbGet<{ sales: number; refunds: number }>(
        `SELECT COALESCE(SUM(total) FILTER (WHERE status = 'completed'), 0) AS sales,
                COALESCE(SUM(total) FILTER (WHERE status IN ('cancelled', 'void')), 0) AS refunds
         FROM orders
         WHERE created_at::date BETWEEN $1 AND $2`,
        [range.from, range.to]
      ),
  });

  const expenses = useQuery({
    queryKey: ["pnl", "expenses", range.from, range.to],
    queryFn: () =>
      dbGet<{ total: number }>(
        `SELECT COALESCE(SUM(amount), 0) AS total
         FROM expenses
         WHERE COALESCE(NULLIF(date, '')::date, created_at::date) BETWEEN $1 AND $2`,
        [range.from, range.to]
      ),
  });

  const pnl = useMemo(
    () =>
      computePnl({
        kindRows: kinds.data ?? [],
        totalSales: Number(sales.data?.sales ?? 0),
        refunds: Number(sales.data?.refunds ?? 0),
        expenses: Number(expenses.data?.total ?? 0),
      }),
    [kinds.data, sales.data, expenses.data]
  );

  const failed = kinds.isError || sales.isError || expenses.isError;
  const periodLabel = PERIODS.find((p) => p.key === period)?.label ?? "All Time";

  const chips = (
    <div style={{ display: "flex", gap: 4, flexWrap: "wrap", background: "white", border: `1px solid ${LINE}`, borderRadius: 10, padding: 4 }}>
      {PERIODS.map((p) => (
        <button
          key={p.key}
          onClick={() => setPeriod(p.key)}
          className="btn btn-sm"
          style={{
            background: period === p.key ? "var(--color-primary)" : "transparent",
            color: period === p.key ? "white" : MUTED,
            fontWeight: 600,
          }}
        >
          {p.label}
        </button>
      ))}
    </div>
  );

  return (
    <Page title="Profit & Loss" subtitle="See exactly how shop sales turn into real profit." action={chips}>
      {period === "custom" && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
          <input className="input" type="date" style={{ width: "auto" }} value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} />
          <span style={{ color: FAINT, fontSize: "0.8rem" }}>to</span>
          <input className="input" type="date" style={{ width: "auto" }} value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} />
        </div>
      )}

      {failed && (
        <div className="alert alert-error" style={{ marginBottom: 14, fontSize: "0.82rem" }}>
          Could not load the profit &amp; loss figures. You may not have access to sales or expense data.
        </div>
      )}

      <div style={{ fontSize: "0.78rem", color: FAINT, marginBottom: 10 }}>
        {periodLabel} · {range.from} → {range.to}
      </div>

      {/* Headline cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 12, marginBottom: 16 }}>
        <Kpi
          label="Net Profit"
          value={money(pnl.netProfit)}
          hint="Money left after product cost, service cost, and shop expenses"
          pill="Net Profit Margin"
          pillValue={pct(pnl.netMargin)}
          accent="green"
        />
        <Kpi
          label="Net Sales"
          value={money(pnl.netSales)}
          hint="Sales after discounts and refunds"
          pill="After Discount"
          pillValue={money(pnl.netSales)}
        />
        <Kpi
          label="Gross Profit"
          value={money(pnl.grossProfit)}
          hint="After direct product and service costs"
          pill="Gross Margin"
          pillValue={pct(pnl.grossMargin)}
        />
        <Kpi
          label="Operating Expenses"
          value={money(pnl.shopExpenses)}
          hint="Rent, salaries, electricity, internet, and shop running costs"
          pill="From Gross Profit"
          pillValue={pct(margin(pnl.shopExpenses, pnl.grossProfit))}
          accent="red"
        />
      </div>

      {/* Sub-totals */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, marginBottom: 16 }}>
        <div className="card">
          <Caption>Total Sales</Caption>
          <div style={{ fontSize: "1.25rem", fontWeight: 800, color: INK, marginTop: 4, ...TAB }}>{money(pnl.totalSales)}</div>
          <div style={{ fontSize: "0.72rem", color: FAINT, marginTop: 4 }}>Products + services before discount</div>
        </div>
        <div className="card">
          <Caption>Discounts Given</Caption>
          <div style={{ fontSize: "1.25rem", fontWeight: 800, color: RED, marginTop: 4, ...TAB }}>{money(pnl.discounts)}</div>
          <div style={{ fontSize: "0.72rem", color: FAINT, marginTop: 4 }}>Amount reduced before profit calculation</div>
        </div>
      </div>

      {/* Product / service breakdown */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16, marginBottom: 16 }}>
        <div className="card">
          <CardHead icon={"\u{1F4E6}"} title="Product Sales" subtitle="Oil, filters, and inventory items" />
          <div style={{ marginTop: 14 }}>
            <Caption>Gross Profit</Caption>
            <div style={{ fontSize: "1.35rem", fontWeight: 800, color: INK, marginTop: 4, ...TAB }}>
              {money(pnl.productSales - pnl.productCost)}
            </div>
            <div style={{ fontSize: "0.72rem", color: FAINT, marginTop: 6 }}>Uses product sales after discount and refund, minus product cost.</div>
          </div>
          <div style={{ marginTop: 12, borderTop: `1px solid ${LINE}`, paddingTop: 4 }}>
            <Line label="Total Sales" value={money(pnl.productSales)} />
            <Line label="Net Product Sales" hint="After discount and refund" value={money(pnl.productSales)} tone="strong" />
            <Line label="Product Cost" hint="Cost of goods sold" value={money(pnl.productCost)} tone="muted" />
          </div>
        </div>

        <div className="card">
          <CardHead icon={"\u{1F527}"} title="Services" subtitle="Wash, labour, and direct service work" />
          <div style={{ marginTop: 14 }}>
            <Caption>Gross Profit</Caption>
            <div style={{ fontSize: "1.35rem", fontWeight: 800, color: INK, marginTop: 4, ...TAB }}>
              {money(pnl.serviceSales - pnl.serviceCost)}
            </div>
            <div style={{ fontSize: "0.72rem", color: FAINT, marginTop: 6 }}>Uses service sales after discount, minus direct service and labour cost.</div>
          </div>
          <div style={{ marginTop: 12, borderTop: `1px solid ${LINE}`, paddingTop: 4 }}>
            <Line label="Total Sales" value={money(pnl.serviceSales)} />
            <Line label="Net Service Sales" hint="After discount" value={money(pnl.serviceSales)} tone="strong" />
            <Line label="Service Cost" hint="Direct service / labour cost" value={money(pnl.serviceCost)} tone="muted" />
          </div>
        </div>
      </div>

      {/* Income statement */}
      <div className="card">
        <div style={{ display: "flex", alignItems: "center", gap: 10, borderBottom: `1px solid ${LINE}`, paddingBottom: 12, marginBottom: 4 }}>
          <div style={{ width: 32, height: 32, borderRadius: 10, background: SOFT, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.95rem", flexShrink: 0 }}>
            {"\u{1F9FE}"}
          </div>
          <div>
            <div style={{ fontSize: "0.88rem", fontWeight: 700, color: "#1e293b" }}>Income Statement</div>
            <div style={{ fontSize: "0.72rem", color: FAINT }}>Single source of truth for how profit is calculated</div>
          </div>
        </div>

        <SectionLabel>Sales Flow</SectionLabel>
        <Line label="Total Sales" hint="Gross sales before discount" value={money(pnl.totalSales)} />
        <Line label="Discounts Given" hint="Discount deducted before profit" value={money(pnl.discounts)} tone="muted" />
        <Line label="Refunds" hint="Voided and cancelled bills in this period" value={money(pnl.refunds)} tone="muted" />
        <Line
          label="Sales After Discount"
          hint="Total Sales minus Discounts Given and refunds"
          value={money(pnl.totalSales - pnl.discounts - pnl.refunds)}
          tone="strong"
        />
        <TotalBox label="Net Sales" hint="Sales left after discount and refunds" value={money(pnl.netSales)} />

        <SectionLabel>Direct Costs</SectionLabel>
        <Line label={"\u{1F4E6}  Product Cost"} hint="Cost of goods sold" value={money(pnl.productCost)} tone="muted" />
        <Line label={"\u{1F527}  Service Cost"} hint="Direct service / labour cost" value={money(pnl.serviceCost)} tone="muted" />
        <TotalBox
          label="Gross Profit"
          hint="Net Sales minus Product Cost and Service Cost"
          value={money(pnl.grossProfit)}
          sub={`Gross Margin ${pct(pnl.grossMargin)}`}
        />

        <SectionLabel>Operating Expenses</SectionLabel>
        <Line
          label="Shop Expenses"
          hint="Rent, salaries, electricity, internet, and other running costs"
          value={money(pnl.shopExpenses)}
          tone="muted"
        />

        <div style={{ borderTop: `2px solid ${LINE}`, marginTop: 14 }} />

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, background: "#f0fdf4", borderRadius: 12, padding: "14px 16px", marginTop: 12 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <span style={{ color: GREEN, fontSize: "1rem", lineHeight: 1.4 }}>{"\u2197"}</span>
            <div>
              <div style={{ fontSize: "0.85rem", fontWeight: 800, letterSpacing: "0.02em", textTransform: "uppercase", color: INK }}>Net Profit</div>
              <div style={{ fontSize: "0.72rem", color: MUTED }}>Gross Profit minus Shop Expenses</div>
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: "1.15rem", fontWeight: 800, color: GREEN, ...TAB }}>{money(pnl.netProfit)}</div>
            <div style={{ fontSize: "0.72rem", fontWeight: 600, color: "#15803d", marginTop: 4, ...TAB }}>
              Net Profit Margin {pct(pnl.netMargin)}
            </div>
          </div>
        </div>
      </div>
    </Page>
  );
}




