import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ResponsiveContainer, AreaChart, Area, LineChart, Line,
  BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import { dbSelect, dbGet, dbExecute } from "../../lib/db";
import { currency, d } from "../../lib/format";
import { Page } from "../../components/Page";
import { ReminderModal, ReminderDraft } from "../../components/ReminderModal";
import { REMINDER_SELECT, kindMeta, relativeDue, priorityColor, bucketOf } from "../../lib/reminders";
import type { ReminderWithRefs } from "../../lib/reminders";

// Palette shared by the pies so the same brand/category keeps its colour.
const CHART_COLORS = ["#2563eb", "#16a34a", "#d97706", "#dc2626", "#7c3aed", "#0891b2", "#db2777", "#65a30d"];

/** Recharts formatters receive raw values, so normalise before pretty-printing. */
function money(value: number | string | ReadonlyArray<number | string> | undefined): string {
  return currency(Number(value) || 0);
}

function ChartEmpty({ text, height = 220 }: { text: string; height?: number }) {
  return (
    <div style={{ height, display: "flex", alignItems: "center", justifyContent: "center", color: "#94a3b8", fontSize: "0.875rem" }}>
      {text}
    </div>
  );
}

export default function Dashboard() {
  const qc = useQueryClient();
  const [showReminderModal, setShowReminderModal] = useState(false);
  const [reminderDraft, setReminderDraft] = useState<ReminderDraft | null>(null);

  const { data: todaySales } = useQuery({
    queryKey: ["today_sales"],
    queryFn: () => dbGet<{ total: number; count: number }>(
      "SELECT COALESCE(SUM(total), 0) as total, COUNT(*) as count FROM orders WHERE status = 'completed' AND created_at::date = CURRENT_DATE"
    ),
  });

  const { data: weekSales } = useQuery({
    queryKey: ["week_sales"],
    queryFn: () => dbGet<{ total: number; count: number }>(
      "SELECT COALESCE(SUM(total), 0) as total, COUNT(*) as count FROM orders WHERE status = 'completed' AND created_at >= now() - interval '7 days'"
    ),
  });

  const { data: lowStock } = useQuery({
    queryKey: ["low_stock"],
    queryFn: () => dbSelect<{ id: number; name: string; stock_qty: number; low_stock_threshold: number }>(
      "SELECT id, name, stock_qty, low_stock_threshold FROM products WHERE active = 1 AND stock_qty <= low_stock_threshold LIMIT 8"
    ),
  });

  const { data: recentOrders } = useQuery({
    queryKey: ["recent_orders"],
    queryFn: () => dbSelect<{ id: number; total: number; customer_name: string; created_at: string; status: string }>(
      "SELECT o.id, o.total, COALESCE(c.name, 'Walking Customer') as customer_name, o.created_at, o.status FROM orders o LEFT JOIN customers c ON o.customer_id = c.id ORDER BY o.id DESC LIMIT 8"
    ),
  });

  const { data: counts } = useQuery({
    queryKey: ["counts"],
    queryFn: () => dbGet<{ products: number; customers: number; orders_today: number; low_stock: number }>(
      "SELECT (SELECT COUNT(*) FROM products WHERE active = 1) as products, (SELECT COUNT(*) FROM customers) as customers, (SELECT COUNT(*) FROM orders WHERE created_at::date = CURRENT_DATE AND status = 'completed') as orders_today, (SELECT COUNT(*) FROM products WHERE active = 1 AND stock_qty <= low_stock_threshold) as low_stock"
    ),
  });

  // ─── Analytics (charts) ─────────────────────────────────────────────
  // The trend series is zero-filled by Postgres itself (generate_series) so
  // quiet days still show on the axis; cost is merged in by day key below.
  const { data: trendRows } = useQuery({
    queryKey: ["analytics", "trend"],
    queryFn: () => dbSelect<{ day: string; label: string; revenue: number; orders: number }>(
      `SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
              to_char(d.day, 'Dy') AS label,
              COALESCE(SUM(o.total), 0) AS revenue,
              COUNT(o.id) AS orders
       FROM orders o
       RIGHT JOIN generate_series(CURRENT_DATE - interval '6 days', CURRENT_DATE, interval '1 day') AS d(day)
         ON o.created_at::date = d.day::date AND o.status = 'completed'
       GROUP BY d.day
       ORDER BY d.day`
    ),
  });

  const { data: costRows } = useQuery({
    queryKey: ["analytics", "cost"],
    queryFn: () => dbSelect<{ day: string; cost: number }>(
      `SELECT to_char(o.created_at, 'YYYY-MM-DD') AS day,
              COALESCE(SUM(oi.qty * COALESCE(p.cost_price, 0)), 0) AS cost
       FROM orders o
       JOIN order_items oi ON oi.order_id = o.id AND oi.kind = 'product'
       LEFT JOIN products p ON p.id = oi.ref_id
       WHERE o.status = 'completed' AND o.created_at >= CURRENT_DATE - interval '6 days'
       GROUP BY 1 ORDER BY 1`
    ),
  });

  // Where the money comes from, last 30 days.
  const { data: brandMix } = useQuery({
    queryKey: ["analytics", "brand_mix"],
    queryFn: () => dbSelect<{ name: string; revenue: number }>(
      `SELECT COALESCE(b.name, 'Unbranded') AS name, SUM(oi.line_total) AS revenue
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id AND o.status = 'completed'
       LEFT JOIN products p ON p.id = oi.ref_id
       LEFT JOIN brands b ON b.id = p.brand_id
       WHERE oi.kind = 'product' AND o.created_at >= CURRENT_DATE - interval '30 days'
       GROUP BY 1 ORDER BY revenue DESC LIMIT 8`
    ),
  });

  const { data: categoryMix } = useQuery({
    queryKey: ["analytics", "category_mix"],
    queryFn: () => dbSelect<{ name: string; revenue: number }>(
      `SELECT COALESCE(c.name, 'Uncategorised') AS name, SUM(oi.line_total) AS revenue
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id AND o.status = 'completed'
       LEFT JOIN products p ON p.id = oi.ref_id
       LEFT JOIN categories c ON c.id = p.category_id
       WHERE oi.kind = 'product' AND o.created_at >= CURRENT_DATE - interval '30 days'
       GROUP BY 1 ORDER BY revenue DESC LIMIT 8`
    ),
  });

  const { data: topProducts } = useQuery({
    queryKey: ["analytics", "top_products"],
    queryFn: () => dbSelect<{ name: string; qty: number; revenue: number }>(
      `SELECT oi.product_name AS name, SUM(oi.qty) AS qty, SUM(oi.line_total) AS revenue
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id AND o.status = 'completed'
       WHERE oi.kind = 'product' AND o.created_at >= CURRENT_DATE - interval '30 days'
       GROUP BY 1 ORDER BY revenue DESC LIMIT 8`
    ),
  });


  // ─── Notification centre ────────────────────────────────────────────
  const { data: notifs } = useQuery({
    queryKey: ["reminders", "dashboard"],
    queryFn: () =>
      dbSelect<ReminderWithRefs>(
        `${REMINDER_SELECT}
         WHERE r.status = 'pending'
         ORDER BY CASE WHEN r.due_at IS NULL THEN 1 ELSE 0 END, r.due_at ASC NULLS LAST
         LIMIT 50`
      ),
    refetchInterval: 30_000,
  });

  // Customers we haven't seen in 60+ days (win-back call list).
  const { data: lapsedCustomers } = useQuery({
    queryKey: ["reminders", "lapsed"],
    queryFn: () =>
      dbSelect<{ id: number; name: string; phone: string; last_visit_at: string | null; days: number }>(
        `SELECT id, name, phone, last_visit_at,
           EXTRACT(day FROM now() - NULLIF(last_visit_at, '')::timestamptz)::int AS days
         FROM customers
         WHERE phone <> ''
           AND last_visit_at IS NOT NULL
           AND NULLIF(last_visit_at, '')::timestamptz < now() - interval '60 days'
         ORDER BY last_visit_at ASC
         LIMIT 5`
      ),
    refetchInterval: 60_000,
  });

  // Vendor payables falling due within 7 days.
  const { data: duePayables } = useQuery({
    queryKey: ["reminders", "payables"],
    queryFn: () =>
      dbSelect<{ id: number; vendor_name: string; amount: number; due_date: string | null }>(
        `SELECT vp.id, vd.name AS vendor_name, vp.amount, vp.due_date
         FROM vendor_payables vp JOIN vendors vd ON vd.id = vp.vendor_id
         WHERE vp.status = 'pending'
           AND vp.due_date IS NOT NULL AND vp.due_date <> ''
           AND vp.due_date::timestamptz < now() + interval '7 days'
         ORDER BY vp.due_date ASC
         LIMIT 5`
      ),
    refetchInterval: 60_000,
  });

  async function actReminder(id: number, mode: "done" | "dismissed") {
    await dbExecute(
      `WITH d AS (UPDATE reminders SET status=$2, completed_at=now(), updated_at=now() WHERE id=$1 RETURNING *)
       INSERT INTO reminders (shop_id, kind, title, details, due_at, due_km, last_mileage,
         customer_id, vehicle_id, vendor_id, order_id, priority, recurrence_days, created_by_user_id)
       SELECT shop_id, kind, title, details, due_at + (recurrence_days || ' days')::interval,
         due_km, last_mileage, customer_id, vehicle_id, vendor_id, order_id, priority,
         recurrence_days, created_by_user_id
       FROM d WHERE $2 = 'done' AND recurrence_days IS NOT NULL`,
      [id, mode]
    );
    qc.invalidateQueries({ queryKey: ["reminders"] });
    qc.invalidateQueries({ queryKey: ["reminder_counts"] });
  }

  const pendingNotifs = (notifs ?? []).filter((r) => r.status === "pending");
  const groups = {
    overdue: pendingNotifs.filter((r) => bucketOf(r) === "overdue"),
    today: pendingNotifs.filter((r) => bucketOf(r) === "today"),
    upcoming: pendingNotifs.filter((r) => bucketOf(r) === "upcoming").slice(0, 6),
  };

  // Merge the two daily series into one zero-filled trend for the charts.
  const costByDay = new Map<string, number>(
    (costRows ?? []).map((r) => [r.day, Number(r.cost)] as [string, number])
  );
  const trend = (trendRows ?? []).map((r) => {
    const revenue = Number(r.revenue);
    const cost = costByDay.get(r.day) ?? 0;
    return { day: r.day, label: r.label, revenue, cost, profit: revenue - cost, orders: Number(r.orders) };
  });

  const brandData = (brandMix ?? []).map((r) => ({ name: r.name, value: Number(r.revenue) }));
  const categoryData = (categoryMix ?? []).map((r) => ({ name: r.name, value: Number(r.revenue) }));
  const topData = (topProducts ?? []).map((r) => ({ name: r.name, value: Number(r.revenue), qty: Number(r.qty) }));

  const weekProfit = trend.reduce((sum, r) => sum + r.profit, 0);
  const bestDay = trend.reduce<{ label: string; revenue: number }>(
    (best, r) => (r.revenue > best.revenue ? r : best),
    { label: "—", revenue: 0 }
  );
  const hasTrend = trend.some((r) => r.revenue > 0 || r.cost > 0);

  const stats = [
    { label: "Today's Sales", value: currency(todaySales?.total ?? 0), sub: `${todaySales?.count ?? 0} orders` },
    { label: "This Week", value: currency(weekSales?.total ?? 0), sub: `${weekSales?.count ?? 0} orders` },
    { label: "Profit (7d)", value: currency(weekProfit), sub: `best day ${bestDay.label}` },
    { label: "Active Products", value: String(counts?.products ?? 0), sub: "in catalog" },
    { label: "Total Customers", value: String(counts?.customers ?? 0), sub: "registered" },
    { label: "Low Stock", value: String(counts?.low_stock ?? 0), sub: "need restocking" },
  ];

  return (
    <Page title="Dashboard" subtitle="Zafar Lubricants — Overview">
      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 24 }}>
        {stats.map((s) => (
          <div key={s.label} className="stat-card">
            <div className="stat-label">{s.label}</div>
            <div className="stat-value">{s.value}</div>
            <div className="stat-sub">{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Notification centre */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontWeight: 600 }}>🔔 Notifications</div>
          <button className="btn btn-ghost btn-sm" onClick={() => { setReminderDraft({}); setShowReminderModal(true); }}>
            + Set a reminder
          </button>
        </div>

        {pendingNotifs.length === 0 && !lapsedCustomers?.length && !duePayables?.length ? (
          <div style={{ color: "#16a34a", fontSize: "0.875rem", padding: 8 }}>✓ All clear — nothing needs your attention</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14 }}>
            {/* Overdue + today */}
            <div>
              {[
                { key: "overdue", label: "🔴 Overdue", rows: groups.overdue, bg: "#fef2f2", dueColor: "#dc2626" },
                { key: "today", label: "🟠 Due today", rows: groups.today, bg: "#fffbeb", dueColor: "#d97706" },
              ].map((g) => (
                <div key={g.key} style={{ marginBottom: g.rows.length ? 12 : 0, display: g.rows.length ? "block" : "none" }}>
                  <div style={{ fontSize: "0.75rem", fontWeight: 700, color: g.dueColor, marginBottom: 4 }}>
                    {g.label} ({g.rows.length})
                  </div>
                  {g.rows.map((r) => {
                    const meta = kindMeta(r.kind);
                    return (
                      <div key={r.id} style={{ display: "flex", gap: 8, alignItems: "center", padding: "6px 8px", borderRadius: 8, background: g.bg, marginBottom: 4 }}>
                        <span style={{ width: 8, height: 8, borderRadius: 4, background: priorityColor(r.priority), flexShrink: 0 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: "0.82rem", fontWeight: 600 }}>{meta.icon} {r.title}</div>
                          <div style={{ fontSize: "0.72rem", color: "#64748b" }}>
                            {r.about} · <span style={{ color: g.dueColor, fontWeight: 600 }}>{relativeDue(r.due_at)}</span>
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                          <button title="Mark done" style={{ border: "none", background: "#16a34a", color: "white", borderRadius: 4, width: 24, height: 24, cursor: "pointer", fontSize: 12 }}
                            onClick={() => actReminder(r.id, "done")}>✓</button>
                          <button title="Dismiss" style={{ border: "none", background: "#f1f5f9", color: "#64748b", borderRadius: 4, width: 24, height: 24, cursor: "pointer", fontSize: 12 }}
                            onClick={() => actReminder(r.id, "dismissed")}>✕</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>

            {/* Upcoming */}
            {groups.upcoming.length > 0 && (
              <div>
                <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "#2563eb", marginBottom: 4 }}>
                  🔵 Upcoming ({pendingNotifs.filter((x) => bucketOf(x) === "upcoming").length})
                </div>
                {groups.upcoming.map((r) => {
                  const meta = kindMeta(r.kind);
                  return (
                    <div key={r.id} style={{ display: "flex", gap: 8, alignItems: "center", padding: "6px 8px", borderRadius: 8, background: "#eff6ff", marginBottom: 4 }}>
                      <span style={{ width: 8, height: 8, borderRadius: 4, background: priorityColor(r.priority), flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: "0.82rem", fontWeight: 600 }}>{meta.icon} {r.title}</div>
                        <div style={{ fontSize: "0.72rem", color: "#64748b" }}>{r.about} · {relativeDue(r.due_at)}</div>
                      </div>
                      <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                        <button title="Mark done" style={{ border: "none", background: "#16a34a", color: "white", borderRadius: 4, width: 24, height: 24, cursor: "pointer", fontSize: 12 }}
                          onClick={() => actReminder(r.id, "done")}>✓</button>
                        <button title="Dismiss" style={{ border: "none", background: "#f1f5f9", color: "#64748b", borderRadius: 4, width: 24, height: 24, cursor: "pointer", fontSize: 12 }}
                          onClick={() => actReminder(r.id, "dismissed")}>✕</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Smart alerts: lapsed customers + vendor payments */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {(lapsedCustomers?.length ?? 0) > 0 && (
                <div>
                  <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "#92400e", marginBottom: 4 }}>
                    📞 Haven&apos;t seen them in a while
                  </div>
                  {lapsedCustomers!.map((c) => (
                    <div key={c.id} style={{ padding: "6px 8px", borderRadius: 8, background: "#fef3c7", marginBottom: 4, fontSize: "0.8rem" }}>
                      <b>{c.name}</b> · {c.phone} · last seen {c.days}d ago
                    </div>
                  ))}
                </div>
              )}
              {(duePayables?.length ?? 0) > 0 && (
                <div>
                  <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "#7c2d12", marginBottom: 4 }}>
                    💳 Vendor payments due this week
                  </div>
                  {duePayables!.map((p) => (
                    <div key={p.id} style={{ padding: "6px 8px", borderRadius: 8, background: "#ffedd5", marginBottom: 4, fontSize: "0.8rem" }}>
                      <b>{p.vendor_name}</b> · {currency(p.amount)} · due {p.due_date ? d(p.due_date) : "—"}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Analytics */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        {/* Revenue trend */}
        <div className="card">
          <div style={{ fontWeight: 600 }}>Revenue trend</div>
          <div style={{ fontSize: "0.75rem", color: "var(--color-muted)", marginBottom: 12 }}>Completed sales, last 7 days</div>
          {hasTrend ? (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={trend} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#2563eb" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#2563eb" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} width={64} />
                <Tooltip formatter={money} />
                <Area type="monotone" dataKey="revenue" name="Revenue" stroke="#2563eb" strokeWidth={2} fill="url(#revenueFill)" />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <ChartEmpty text="No completed sales in the last 7 days" />
          )}
        </div>

        {/* Revenue vs cost */}
        <div className="card">
          <div style={{ fontWeight: 600 }}>Revenue vs cost</div>
          <div style={{ fontSize: "0.75rem", color: "var(--color-muted)", marginBottom: 12 }}>Daily takings against parts cost, last 7 days</div>
          {hasTrend ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={trend} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} width={64} />
                <Tooltip formatter={money} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="revenue" name="Revenue" fill="#2563eb" radius={[4, 4, 0, 0]} />
                <Bar dataKey="cost" name="Cost" fill="#f59e0b" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <ChartEmpty text="No completed sales in the last 7 days" />
          )}
        </div>

        {/* Best sellers */}
        <div className="card">
          <div style={{ fontWeight: 600 }}>Top products</div>
          <div style={{ fontSize: "0.75rem", color: "var(--color-muted)", marginBottom: 12 }}>Best sellers by revenue, last 30 days</div>
          {topData.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={topData} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 12 }} />
                <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 11 }} />
                <Tooltip formatter={money} />
                <Bar dataKey="value" name="Revenue" fill="#16a34a" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <ChartEmpty text="No product sales in the last 30 days" height={240} />
          )}
        </div>

        {/* Brand split */}
        <div className="card">
          <div style={{ fontWeight: 600 }}>Sales by brand</div>
          <div style={{ fontSize: "0.75rem", color: "var(--color-muted)", marginBottom: 12 }}>Revenue share, last 30 days</div>
          {brandData.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={brandData} dataKey="value" nameKey="name" innerRadius={48} outerRadius={84} paddingAngle={2}>
                  {brandData.map((entry, i) => (
                    <Cell key={entry.name} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={money} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <ChartEmpty text="No product sales in the last 30 days" height={240} />
          )}
        </div>

        {/* Category split */}
        <div className="card">
          <div style={{ fontWeight: 600 }}>Sales by category</div>
          <div style={{ fontSize: "0.75rem", color: "var(--color-muted)", marginBottom: 12 }}>Revenue share, last 30 days</div>
          {categoryData.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={categoryData} dataKey="value" nameKey="name" innerRadius={48} outerRadius={84} paddingAngle={2}>
                  {categoryData.map((entry, i) => (
                    <Cell key={entry.name} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={money} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <ChartEmpty text="No product sales in the last 30 days" height={240} />
          )}
        </div>

        {/* Daily profit */}
        <div className="card">
          <div style={{ fontWeight: 600 }}>Daily profit</div>
          <div style={{ fontSize: "0.75rem", color: "var(--color-muted)", marginBottom: 12 }}>Revenue minus parts cost, last 7 days</div>
          {hasTrend ? (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={trend} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} width={64} />
                <Tooltip formatter={money} />
                <Line type="monotone" dataKey="profit" name="Profit" stroke="#16a34a" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <ChartEmpty text="No completed sales in the last 7 days" />
          )}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {/* Recent Orders */}
        <div className="card">
          <div style={{ fontWeight: 600, marginBottom: 12 }}>Recent Sales</div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Customer</th>
                  <th>Amount</th>
                  <th>Time</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {(!recentOrders || recentOrders.length === 0) && (
                  <tr><td colSpan={5} style={{ textAlign: "center", color: "#94a3b8" }}>No sales yet</td></tr>
                )}
                {recentOrders?.map((o) => (
                  <tr key={o.id}>
                    <td>{o.id}</td>
                    <td>{o.customer_name}</td>
                    <td style={{ fontWeight: 600 }}>{currency(o.total)}</td>
                    <td>{d(o.created_at)}</td>
                    <td><span className={`badge badge-${o.status === "completed" ? "green" : o.status === "cancelled" ? "red" : "yellow"}`}>{o.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Low Stock */}
        <div className="card">
          <div style={{ fontWeight: 600, marginBottom: 12 }}>⚠ Low Stock Alert</div>
          {(!lowStock || lowStock.length === 0) && (
            <div style={{ color: "#16a34a", fontSize: "0.875rem", padding: 8 }}>✓ All products well stocked</div>
          )}
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Product</th><th>Stock</th><th>Threshold</th></tr>
              </thead>
              <tbody>
                {lowStock?.map((p) => (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td><span style={{ color: p.stock_qty <= 0 ? "red" : "#d97706", fontWeight: 600 }}>{p.stock_qty}</span></td>
                    <td>{p.low_stock_threshold}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <ReminderModal open={showReminderModal} onClose={() => { setShowReminderModal(false); setReminderDraft(null); }} initial={reminderDraft} />
    </Page>
  );
}
