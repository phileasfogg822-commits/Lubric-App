import { useState, useRef, useEffect, useMemo } from "react";
import { dbSelect } from "../../lib/db";
import { currency } from "../../lib/format";
import type { CustomerType } from "../../lib/types";
import Suggestions from "../../components/Suggestions";

export interface SearchResult {
  type: "product" | "container" | "service" | "used_oil";
  id: number;
  name: string;
  price: number;
  price_walking: number | null;
  price_returning: number;
  price_wholesale: number;
  stock_qty?: number;
  remaining_volume?: number;
  status?: string;
  wholesale_min_qty?: number;
  raw: any;
}

interface Props {
  onSelect: (item: SearchResult) => void;
  customerType: CustomerType;
}

function getPrice(item: any, tier: CustomerType, qty: number): number {
  if (tier === "walking") return item.price_walking ?? item.price_returning;
  if (tier === "wholesale") {
    const minQty = item.wholesale_min_qty || 10;
    if (qty >= minQty && item.price_wholesale > 0) return item.price_wholesale;
    return item.price_returning;
  }
  return item.price_returning;
}

export default function POSSearch({ onSelect, customerType }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    const timer = setTimeout(async () => {
      try {
        const q = `%${query.toLowerCase()}%`;
        const [products, services, containers, drums] = await Promise.all([
          dbSelect<any>("SELECT id, name, price_walking, price_returning, price_wholesale, stock_qty, wholesale_min_qty FROM products WHERE active = 1 AND (LOWER(name) LIKE $1 OR sku LIKE $2 OR barcode LIKE $2) ORDER BY name LIMIT 10", [q, `%${query}%`]),
          dbSelect<any>("SELECT id, name, price FROM services WHERE active = 1 AND LOWER(name) LIKE $1 ORDER BY name LIMIT 5", [q]),
          dbSelect<any>("SELECT c.id, c.product_id, c.barcode, c.remaining_volume, c.status, p.name as product_name, p.price_walking, p.price_returning, p.price_wholesale, p.wholesale_min_qty FROM containers c JOIN products p ON c.product_id = p.id WHERE c.status IN ('opened','full') AND c.remaining_volume > 0 AND LOWER(p.name) LIKE $1 ORDER BY c.opened_at DESC LIMIT 5", [q]),
          dbSelect<any>("SELECT id, current_litres, capacity FROM used_oil_drum ORDER BY id LIMIT 1"),
        ]);
        const oilMatch = /oil|drum|used/i.test(query);
        const items: SearchResult[] = [
          ...products.map((p: any) => ({ type: "product" as const, id: p.id, name: p.name, price: getPrice(p, customerType, 1), price_walking: p.price_walking, price_returning: p.price_returning, price_wholesale: p.price_wholesale, stock_qty: p.stock_qty, wholesale_min_qty: p.wholesale_min_qty, raw: p })),
          ...services.map((s: any) => ({ type: "service" as const, id: s.id, name: s.name, price: s.price, price_walking: s.price, price_returning: s.price, price_wholesale: s.price, raw: s })),
          ...containers.map((c: any) => ({ type: "container" as const, id: c.id, name: c.product_name, price: getPrice(c, customerType, 1), price_walking: c.price_walking, price_returning: c.price_returning, price_wholesale: c.price_wholesale, remaining_volume: c.remaining_volume, status: c.status, wholesale_min_qty: c.wholesale_min_qty, raw: c })),
        ...(drums.length && oilMatch ? [{ type: "used_oil" as const, id: drums[0].id, name: "Used Oil Drum (drop-off)", price: 0, price_walking: 0, price_returning: 0, price_wholesale: 0, remaining_volume: drums[0].current_litres, raw: drums[0] }] : []),
        ];
        setResults(items);
        setSelectedIndex(0);
      } catch (err) { console.error("Search error:", err); }
    }, 250);
    return () => clearTimeout(timer);
  }, [query, customerType]);

  // Outside-click and Escape closing are handled by <Suggestions /> itself.
  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") { setShowDropdown(false); return; }
    if (!showDropdown || !results.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setSelectedIndex((i) => Math.min(i + 1, results.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSelectedIndex((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter" || (e.key === "Tab" && !e.shiftKey)) {
      // Enter/Tab accepts the highlighted suggestion instead of just leaving the field.
      const pick = results[selectedIndex];
      if (!pick) return;
      e.preventDefault();
      handleSelect(pick);
    }
  }

  function handleSelect(item: SearchResult) {
    onSelect(item);
    setQuery("");
    setResults([]);
    setShowDropdown(false);
    inputRef.current?.focus();
  }

  const grouped = useMemo(() => {
    const g: Record<string, SearchResult[]> = {};
    for (const r of results) { if (!g[r.type]) g[r.type] = []; g[r.type].push(r); }
    return g;
  }, [results]);

  const labels: Record<string, string> = { product: "Products", container: "Partial Containers", service: "Services", used_oil: "Used Oil Drum" };

  return (
    <div>
      <input ref={inputRef} className="input" placeholder="Search products, services, containers..." value={query}
        onChange={(e) => { setQuery(e.target.value); setShowDropdown(true); }}
        onFocus={() => { if (results.length) setShowDropdown(true); }}
        onKeyDown={handleKeyDown} />
      <Suggestions anchorRef={inputRef} open={showDropdown && (query.trim().length > 0 || results.length > 0)} onClose={() => setShowDropdown(false)}>
          {results.length === 0 && query.trim() && <div style={{ padding: "1.5rem", textAlign: "center", fontSize: "0.85rem", color: "#94a3b8" }}>No items found</div>}
          {results.length === 0 && !query.trim() && <div style={{ padding: "1.5rem", textAlign: "center", fontSize: "0.85rem", color: "#94a3b8" }}>Type to search...</div>}
          {Object.entries(grouped).map(([type, items]) => (
            <div key={type}>
              <div style={{ padding: "6px 12px", fontSize: "0.7rem", fontWeight: 600, color: "#64748b", background: "#f8fafc", borderBottom: "1px solid #e2e8f0", textTransform: "uppercase", position: "sticky", top: 0 }}>{labels[type] || type}</div>
              {items.map((item) => {
                const idx = results.indexOf(item);
                return (
                  <button type="button" key={`${item.type}-${item.id}`} onClick={() => handleSelect(item)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", padding: "10px 12px", border: "none", borderBottom: "1px solid #f1f5f9", background: idx === selectedIndex ? "#eff6ff" : "transparent", cursor: "pointer", textAlign: "left", fontSize: "0.85rem" }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 500 }}>{item.name}</div>
                      <div style={{ fontSize: "0.7rem", color: "#94a3b8", marginTop: 2 }}>
                        {item.type === "product" && <>Stock: {item.stock_qty}{item.wholesale_min_qty && item.wholesale_min_qty > 1 && <> &middot; Min: {item.wholesale_min_qty}</>}</>}
                        {item.type === "container" && <>{item.remaining_volume?.toFixed(1)}L left</>}
                        {item.type === "used_oil" && <>Drum: {item.remaining_volume?.toFixed(1)}L collected</>}
                      </div>
                    </div>
                    <div style={{ fontWeight: 600, color: "var(--color-primary)", whiteSpace: "nowrap", marginLeft: 12 }}>{item.type === "used_oil" ? "Drop-off" : currency(item.price)}</div>
                  </button>
                );
              })}
            </div>
          ))}
      </Suggestions>
    </div>
  );
}
