import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../lib/auth";

/**
 * Which outlet is this screen showing?
 *
 * Renders nothing when the login reaches a single outlet - there is no decision
 * to make, and a control that cannot change anything is just noise above the
 * nav. Once there are two or more, this becomes a real switch, and it is the
 * only place in the app where "which shop" is chosen; every request downstream
 * inherits it from the X-Shop-Id header.
 *
 * Switching invalidates the whole query cache. That is not tidiness: without it
 * React Query would happily keep serving the previous outlet's customers and
 * totals from cache under the new outlet's name, and the shopkeeper would read
 * one outlet's figures while looking at another outlet's label. Every query
 * key in the app is written without an outlet component, so invalidating
 * everything is both the correct and the only safe move.
 */
export default function ShopSelector() {
  const { outlets, activeShopId, switchOutlet } = useAuth();
  const qc = useQueryClient();

  if (!outlets || outlets.length < 2) return null;

  const active = outlets.find((o) => o.shop_id === activeShopId) ?? outlets[0];

  function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = parseInt(e.target.value, 10);
    if (!Number.isFinite(next) || next === activeShopId) return;
    switchOutlet(next);
    qc.invalidateQueries();
  }

  return (
    <div style={{ padding: "0.5rem 0.75rem", borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
      <label
        htmlFor="outlet-select"
        style={{
          display: "block",
          fontSize: "0.6rem",
          letterSpacing: "0.08em",
          color: "#94a3b8",
          marginBottom: 4,
          textTransform: "uppercase",
        }}
      >
        Outlet
      </label>
      <select
        id="outlet-select"
        value={String(active?.shop_id ?? "")}
        onChange={onChange}
        style={{
          width: "100%",
          background: "#1e293b",
          color: "white",
          border: "1px solid #334155",
          borderRadius: 4,
          padding: "0.3rem 0.4rem",
          fontSize: "0.75rem",
          cursor: "pointer",
        }}
      >
        {outlets.map((o) => (
          <option key={o.shop_id} value={String(o.shop_id)} style={{ color: "#0f172a" }}>
            {o.name}
          </option>
        ))}
      </select>
    </div>
  );
}