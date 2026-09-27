import { useState, useCallback, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { dbSelect } from "../../lib/db";
import { useAuth } from "../../lib/auth";
import { currency } from "../../lib/format";
import type { Product, CustomerType, CartItem } from "../../lib/types";
import POSSearch, { type SearchResult } from "./POSSearch";
import POSPrint from "./POSPrint";
import { addProduct, addService, addContainer, updateQty, updatePrice, completeSale, releaseLeftoverToCustomer, leftoverLitres, packLitres, repriceAll, updateCapacity, toggleBillByCapacity, toggleLeftoverToContainers, tierPrice, type SaleVehicle } from "./POSCart";
import Suggestions from "../../components/Suggestions";

export default function POS() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [customerName, setCustomerName] = useState("");
  const [customerId, setCustomerId] = useState<number | null>(null);
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerType, setCustomerType] = useState<CustomerType>("walking");
  const [paymentAccountId, setPaymentAccountId] = useState(1);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [notes, setNotes] = useState("");
  const [mileage, setMileage] = useState(0);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [lastSale, setLastSale] = useState<{ orderId: number; items: CartItem[]; total: number; customerName: string; customerPhone: string; mileage: number; notes: string; vehicle: SaleVehicle | null } | null>(null);
  const [customerHistory, setCustomerHistory] = useState<any>(null);
  // Customer name type-ahead
  const nameAnchorRef = useRef<HTMLInputElement>(null);
  const [nameSuggestions, setNameSuggestions] = useState<any[]>([]);
  const [showNameSuggest, setShowNameSuggest] = useState(false);
  const [nameIndex, setNameIndex] = useState(0);
  // Expanded order in the history panel
  const [expandedOrder, setExpandedOrder] = useState<number | null>(null);
  const [orderDetail, setOrderDetail] = useState<any[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  // Vehicle captured with the sale (optional, but handy for repeat jobs).
  const [vehicle, setVehicle] = useState<SaleVehicle>({ registration: "", make: "", model: "", modelYear: "", color: "", condition: "" });
  const [showVehicle, setShowVehicle] = useState(false);
  const vehicleAnchorRef = useRef<HTMLInputElement>(null);
  const [vehicleSuggestions, setVehicleSuggestions] = useState<any[]>([]);
  const [showVehicleSuggest, setShowVehicleSuggest] = useState(false);
  // Remembered engine oil capacity from the customer's vehicle, applied to new lines.
  const [defaultCapacity, setDefaultCapacity] = useState(0);

  const { data: products } = useQuery({ queryKey: ["products"], queryFn: () => dbSelect<Product>("SELECT * FROM products WHERE active = 1 ORDER BY name") });
  const { data: services } = useQuery({ queryKey: ["services"], queryFn: () => dbSelect<any>("SELECT * FROM services WHERE active = 1 ORDER BY name") });
  const { data: customers } = useQuery({ queryKey: ["customers"], queryFn: () => dbSelect<any>("SELECT id, name, phone, customer_type, credit_balance, last_visit_at FROM customers ORDER BY name") });
  const { data: accounts } = useQuery({ queryKey: ["accounts"], queryFn: () => dbSelect<any>("SELECT id, name, type FROM accounts WHERE active = 1 ORDER BY name") });

  const total = cart.reduce((s, x) => s + x.line_total, 0);

  // Load a customer's order history into the right-hand panel.
  const loadHistory = useCallback(async (cust: any) => {
    setExpandedOrder(null);
    setOrderDetail([]);
    try {
      const orders = await dbSelect<any>(
        "SELECT o.id, o.total, o.created_at, o.status, o.mileage, o.notes, o.vehicle_id, v.registration, v.make, v.model, v.model_year, v.color, v.\"condition\" AS vehicle_condition, COUNT(oi.id) as item_count FROM orders o LEFT JOIN order_items oi ON o.id = oi.order_id LEFT JOIN vehicles v ON v.id = o.vehicle_id WHERE o.customer_id = $1 GROUP BY o.id, v.id ORDER BY o.created_at DESC LIMIT 10",
        [cust.id]
      );
      const totalSpent = await dbSelect<any>(
        "SELECT COALESCE(SUM(total), 0) as total FROM orders WHERE customer_id = $1 AND status = 'completed'",
        [cust.id]
      );
      setCustomerHistory({ customer: cust, orders, totalSpent: totalSpent[0]?.total || 0 });
    } catch (e) {
      console.error("History load failed:", e);
      setCustomerHistory({ customer: cust, orders: [], totalSpent: 0 });
    }
  }, []);

  // Picking a suggestion applies the saved pricing tier and loads history at once.
  const pickCustomer = useCallback((cust: any) => {
    setCustomerName(cust.name);
    setCustomerId(cust.id);
    setCustomerPhone(cust.phone ?? "");
    setCustomerType(cust.customer_type || "walking");
    // Tier pricing applies to the whole cart, so re-price what's already in it.
    setCart((c) => repriceAll(c, cust.customer_type || "walking"));
    setShowNameSuggest(false);
    setNameSuggestions([]);
    loadHistory(cust);
    // Prefill the vehicle from this customer's most recent visit, if any.
    dbSelect<any>(
      "SELECT registration, make, model, model_year, color, \"condition\", oil_capacity FROM vehicles WHERE customer_id = $1 ORDER BY id DESC LIMIT 1",
      [cust.id]
    ).then((rows) => {
      if (rows.length) {
        const cap = Number(rows[0].oil_capacity) || 0;
        setDefaultCapacity(cap);
        setVehicle({
          registration: rows[0].registration ?? "",
          make: rows[0].make ?? "",
          model: rows[0].model ?? "",
          modelYear: rows[0].model_year ?? "",
          color: rows[0].color ?? "",
          condition: rows[0].condition ?? "",
        });
        // Prefill the capacity on any product line that has none yet.
        // Capacity drives the pro-rated price, so re-price after applying it.
        if (cap > 0) setCart((c) => repriceAll(
          c.map((x) => x.kind === "product" && !x.capacity ? { ...x, capacity: cap } : x),
          cust.customer_type || "walking"
        ));
      }
    }).catch(() => { /* no vehicle on file — leave the form as-is */ });
  }, [loadHistory]);

  // Find customer by the exact name typed (fallback when nothing is picked).
  const findCustomer = useCallback(async (name: string) => {
    const n = name.trim();
    if (!n) { setCustomerHistory(null); setCustomerId(null); setCustomerPhone(""); return; }
    try {
      const found = await dbSelect<any>(
        "SELECT id, name, phone, customer_type, credit_balance, last_visit_at FROM customers WHERE LOWER(name) = LOWER($1) LIMIT 1",
        [n]
      );
      if (found.length) {
        setCustomerId(found[0].id);
        setCustomerPhone(found[0].phone ?? "");
        setCustomerType(found[0].customer_type || "walking");
        setCart((c) => repriceAll(c, found[0].customer_type || "walking"));
        loadHistory(found[0]);
      } else {
        setCustomerId(null);
        setCustomerPhone("");
        setCustomerHistory(null);
      }
    } catch (e) {
      console.error("Customer lookup failed:", e);
    }
  }, [loadHistory]);

  // Debounced type-ahead over customer names / phone numbers.
  useEffect(() => {
    const q = customerName.trim();
    if (!q) { setNameSuggestions([]); return; }
    const timer = setTimeout(async () => {
      try {
        const rows = await dbSelect<any>(
          "SELECT id, name, phone, customer_type, credit_balance FROM customers WHERE LOWER(name) LIKE $1 OR phone LIKE $2 ORDER BY name LIMIT 8",
          [`%${q.toLowerCase()}%`, `%${q}%`]
        );
        setNameSuggestions(rows);
        setNameIndex(0);
      } catch (e) {
        console.error("Customer search failed:", e);
        setNameSuggestions([]);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [customerName]);

  // Debounced type-ahead over registrations recorded on earlier sales.
  useEffect(() => {
    const q = vehicle.registration.trim();
    if (!q) { setVehicleSuggestions([]); return; }
    const timer = setTimeout(async () => {
      try {
        const rows = await dbSelect<any>(
          "SELECT DISTINCT ON (LOWER(registration)) registration, make, model, model_year, color, \"condition\" FROM vehicles WHERE registration <> '' AND (LOWER(registration) LIKE $1 OR LOWER(make) LIKE $1 OR LOWER(model) LIKE $1) ORDER BY LOWER(registration), id DESC LIMIT 8",
          [`%${q.toLowerCase()}%`]
        );
        setVehicleSuggestions(rows);
      } catch (e) {
        console.error("Vehicle search failed:", e);
        setVehicleSuggestions([]);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [vehicle.registration]);

  // Picking a known plate fills in the rest of the vehicle form.
  function pickVehicle(v: any) {
    setVehicle({
      registration: v.registration ?? "",
      make: v.make ?? "",
      model: v.model ?? "",
      modelYear: v.model_year ?? "",
      color: v.color ?? "",
      condition: v.condition ?? "",
    });
    setShowVehicleSuggest(false);
    setVehicleSuggestions([]);
  }

  // Engine oil capacity + how the line is billed.
  //  - Bill by capacity: charge only for the litres the engine took.
  //  - Leftover to containers: shelve the unused oil instead of the customer taking it.
  function handleUpdateCapacity(id: string, litres: number) {
    setCart((c) => updateCapacity(c, id, litres, customerType));
  }
  function handleToggleBillByCapacity(id: string, on: boolean) {
    setCart((c) => toggleBillByCapacity(c, id, on, customerType));
  }
  function handleToggleLeftoverToContainers(id: string, toContainers: boolean) {
    setCart((c) => toggleLeftoverToContainers(c, id, toContainers));
  }

  /** The line's tier price before capacity pro-rating, for the "was → now" hint. */
  function tierFullPrice(item: CartItem): number {
    if (!item.product) return item.unit_price;
    return tierPrice(item.product, customerType, item.qty);
  }

  function handleNameKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") { setShowNameSuggest(false); return; }
    if (!showNameSuggest || !nameSuggestions.length) {
      if (e.key === "Enter") { e.preventDefault(); findCustomer(customerName); }
      return;
    }
    if (e.key === "ArrowDown") { e.preventDefault(); setNameIndex((i) => Math.min(i + 1, nameSuggestions.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setNameIndex((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter" || (e.key === "Tab" && !e.shiftKey)) {
      const pick = nameSuggestions[nameIndex];
      if (!pick) return;
      e.preventDefault();
      pickCustomer(pick);
    }
  }

  // Expand / collapse an order in the history list.
  async function toggleOrder(orderId: number) {
    if (expandedOrder === orderId) { setExpandedOrder(null); setOrderDetail([]); return; }
    setExpandedOrder(orderId);
    setOrderDetail([]);
    setDetailLoading(true);
    try {
      const lines = await dbSelect<any>(
        "SELECT id, product_name, kind, qty, unit_price, line_total, ref_id, capacity, leftover_litres, leftover_to, leftover_released, billed_by_capacity FROM order_items WHERE order_id = $1 ORDER BY id",
        [orderId]
      );
      setOrderDetail(lines);
    } catch (e) {
      console.error("Order detail failed:", e);
    } finally {
      setDetailLoading(false);
    }
  }

  // Customer came back asking for the unused oil we shelved — hand it over.
  async function giveLeftoverToCustomer(line: any) {
    if (!expandedOrder || !(Number(line.leftover_litres) > 0)) return;
    setError(""); setSuccess("");
    try {
      await releaseLeftoverToCustomer(expandedOrder, line.id, line.ref_id, Number(line.leftover_litres));
      setOrderDetail((rows: any[]) => rows.map((r) => r.id === line.id ? { ...r, leftover_to: "customer", leftover_released: true } : r));
      setSuccess(`${line.leftover_litres}L released to ${customerName.trim() || "customer"} — removed from containers.`);
      setTimeout(() => setSuccess(""), 4000);
    } catch (e: any) { setError(e.message || String(e)); }
  }

  function handleSearchSelect(item: SearchResult) {
    if (item.type === "product") {
      const p = products?.find((pr) => pr.id === item.id);
      if (p) setCart((c) => {
        const cap = defaultCapacity;
        const next = addProduct(c, p, customerType, products ?? []);
        if (!(cap > 0)) return next;
        // Apply the remembered capacity, then re-price so the pro-rating lands.
        return repriceAll(
          next.map((x) => x.kind === "product" && !x.capacity ? { ...x, capacity: cap } : x),
          customerType
        );
      });
    } else if (item.type === "service") {
      setCart((c) => addService(c, item.raw));
    } else if (item.type === "container") {
      setCart((c) => addContainer(c, item.raw, customerType, products ?? []));
    } else if (item.type === "used_oil") {
      const q = prompt("Litres of used oil received:", "5");
      if (!q) return;
      const v = parseFloat(q);
      if (isNaN(v) || v <= 0) return;
      setCart((c) => [...c, { id: `uo-${Date.now()}`, kind: "used_oil", ref_id: item.id, name: "Used Oil (drop-off)", qty: v, unit_price: 0, line_total: 0 }]);
    }
  }

  function handleUpdateQty(id: string, qty: number) {
    setCart((c) => updateQty(c, id, qty, customerType));
  }

  function handleUpdatePrice(id: string, price: number) {
    setCart((c) => updatePrice(c, id, price));
  }

  function handleRemove(id: string) {
    setCart((c) => c.filter((x) => x.id !== id));
  }

  function handleClear() {
    setCart([]);
    setNotes("");
    setMileage(0);
    setCustomerPhone("");
    setVehicle({ registration: "", make: "", model: "", modelYear: "", color: "", condition: "" });
    setVehicleSuggestions([]);
    setShowVehicleSuggest(false);
  }

  async function handleComplete() {
    setError("");
    setSuccess("");
    if (!cart.length) { setError("Cart is empty"); return; }
    try {
      const vh = vehicle.registration.trim() ? vehicle : null;
      const oid = await completeSale(cart, user?.id ?? 1, customerId, paymentAccountId, total, mileage, notes, vh);
      setLastSale({ orderId: oid, items: [...cart], total, customerName: customerName.trim() || "Walk-in", customerPhone: customerPhone, mileage, notes, vehicle: vh });
      setSuccess(`Order #${oid} completed!`);
      handleClear();
      qc.invalidateQueries();
      setTimeout(() => setSuccess(""), 5000);
    } catch (e: any) { setError(e.message || String(e)); }
  }

  // Printable data: live cart takes priority, otherwise the last completed sale
  const printItems = cart.length > 0 ? cart : (lastSale?.items ?? []);
  const printTotal = cart.length > 0 ? total : (lastSale?.total ?? 0);
  const printName = cart.length > 0 ? (customerName.trim() || "Walk-in") : (lastSale?.customerName ?? "Walk-in");
  const printOrderId = cart.length > 0 ? 0 : (lastSale?.orderId ?? 0);
  const printNotes = cart.length > 0 ? notes : (lastSale?.notes ?? "");
  const printVehicle = cart.length > 0 ? (vehicle.registration.trim() ? vehicle : null) : (lastSale?.vehicle ?? null);
  const printMileage = cart.length > 0 ? mileage : (lastSale?.mileage ?? 0);
  const printPhone = cart.length > 0 ? customerPhone : (lastSale?.customerPhone ?? "");
  const canPrint = printItems.length > 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--color-border)", background: "white", display: "flex", gap: 12, alignItems: "center" }}>
        <div style={{ flex: 1, maxWidth: 320 }}>
          <input ref={nameAnchorRef} className="input" placeholder="Customer name..." autoComplete="off" value={customerName}
            onChange={(e) => { setCustomerName(e.target.value); setShowNameSuggest(true); }}
            onKeyDown={handleNameKeyDown}
            onBlur={() => { setTimeout(() => findCustomer(customerName), 150); }}
            style={{ fontSize: "0.85rem" }} />
          <Suggestions anchorRef={nameAnchorRef} open={showNameSuggest && nameSuggestions.length > 0} onClose={() => setShowNameSuggest(false)}>
            {nameSuggestions.map((c, i) => (
              <button type="button" key={c.id} onMouseDown={(e) => e.preventDefault()} onClick={() => pickCustomer(c)}
                style={{ display:"flex", justifyContent:"space-between", alignItems:"center", width:"100%", padding:"8px 12px", border:"none", borderBottom:"1px solid #f1f5f9", background: i === nameIndex ? "#eff6ff" : "transparent", cursor:"pointer", textAlign:"left", fontSize:"0.82rem" }}>
                <span style={{ flex:1 }}>
                  <span style={{ fontWeight:500 }}>{c.name}</span>
                  {c.phone && <span style={{ color:"#94a3b8", fontSize:"0.7rem" }}> · {c.phone}</span>}
                </span>
                <span style={{ fontSize:"0.68rem", textTransform:"capitalize", color:"#64748b", marginLeft:8, whiteSpace:"nowrap" }}>{c.customer_type}</span>
              </button>
            ))}
          </Suggestions>
        </div>
        <div style={{ display: "flex", gap: 2 }}>
          {([["walking","W"],["returning","R"],["wholesale","Wh"]] as [CustomerType,string][]).map(([tier,label]) => (
            <button key={tier} onClick={() => { setCustomerType(tier); setCart((c) => repriceAll(c, tier)); }} style={{ padding:"4px 10px", fontSize:"0.7rem", fontWeight:600, borderRadius:4, cursor:"pointer", background: customerType===tier ? "#cbd5e1" : "#f1f5f9", color: customerType===tier ? "#1e293b" : "#64748b", border: `1px solid ${customerType===tier ? "#94a3b8" : "#e2e8f0"}` }}>{label}</button>
          ))}
        </div>
        <select className="input" value={paymentAccountId} onChange={(e) => setPaymentAccountId(Number(e.target.value))} style={{ fontSize:"0.8rem", width:130 }}>
          {accounts?.map((a:any) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <button type="button" onClick={() => setShowVehicle((v) => !v)} title="Vehicle details"
          style={{ padding:"4px 10px", fontSize:"0.7rem", fontWeight:600, borderRadius:4, cursor:"pointer", whiteSpace:"nowrap", background: showVehicle ? "#cbd5e1" : "#f1f5f9", color: showVehicle ? "#1e293b" : "#64748b", border: `1px solid ${showVehicle ? "#94a3b8" : "#e2e8f0"}` }}>
          Vehicle{vehicle.registration.trim() ? " *" : ""}
        </button>
      </div>
      {showVehicle && (
        <div style={{ padding:"8px 16px", borderBottom:"1px solid var(--color-border)", background:"#f8fafc", display:"flex", gap:6, flexWrap:"wrap", alignItems:"center" }}>
          <div style={{ width:150 }}>
            <input ref={vehicleAnchorRef} className="input" placeholder="Registration" autoComplete="off"
              value={vehicle.registration}
              onChange={(e) => { setVehicle((v) => ({ ...v, registration: e.target.value })); setShowVehicleSuggest(true); }}
              onKeyDown={(e) => { if (e.key === "Escape") setShowVehicleSuggest(false); }}
              style={{ fontSize:"0.8rem" }} />
            <Suggestions anchorRef={vehicleAnchorRef} open={showVehicleSuggest && vehicleSuggestions.length > 0} onClose={() => setShowVehicleSuggest(false)}>
              {vehicleSuggestions.map((v, i) => (
                <button type="button" key={i} onMouseDown={(e) => e.preventDefault()} onClick={() => pickVehicle(v)}
                  style={{ display:"block", width:"100%", padding:"8px 12px", border:"none", borderBottom:"1px solid #f1f5f9", background:"transparent", cursor:"pointer", textAlign:"left", fontSize:"0.8rem" }}>
                  <span style={{ fontWeight:500 }}>{v.registration}</span>
                  <span style={{ color:"#94a3b8", fontSize:"0.7rem" }}> {[v.make, v.model, v.model_year].filter(Boolean).join(" ")}</span>
                </button>
              ))}
            </Suggestions>
          </div>
          <input className="input" placeholder="Make" value={vehicle.make} onChange={(e) => setVehicle((v) => ({ ...v, make: e.target.value }))} style={{ fontSize:"0.8rem", width:110 }} />
          <input className="input" placeholder="Model" value={vehicle.model} onChange={(e) => setVehicle((v) => ({ ...v, model: e.target.value }))} style={{ fontSize:"0.8rem", width:110 }} />
          <input className="input" placeholder="Year" value={vehicle.modelYear} onChange={(e) => setVehicle((v) => ({ ...v, modelYear: e.target.value }))} style={{ fontSize:"0.8rem", width:70 }} />
          <input className="input" placeholder="Colour" value={vehicle.color} onChange={(e) => setVehicle((v) => ({ ...v, color: e.target.value }))} style={{ fontSize:"0.8rem", width:90 }} />
          <input className="input" placeholder="Condition" value={vehicle.condition} onChange={(e) => setVehicle((v) => ({ ...v, condition: e.target.value }))} style={{ fontSize:"0.8rem", flex:1, minWidth:120 }} />
          {vehicle.registration.trim() !== "" && (
            <button type="button" className="btn btn-ghost btn-sm" style={{ fontSize:"0.7rem" }}
              onClick={() => { setVehicle({ registration:"", make:"", model:"", modelYear:"", color:"", condition:"" }); setVehicleSuggestions([]); }}>Clear</button>
          )}
        </div>
      )}
      <div style={{ display:"flex", flex:1, overflow:"hidden" }}>
        <div style={{ flex:1, display:"flex", flexDirection:"column", borderRight:"1px solid var(--color-border)" }}>
          <div style={{ padding:"6px 16px" }}>
            {error && <div className="alert alert-error" style={{ marginBottom:4, padding:"6px 10px", fontSize:"0.8rem" }}>{error}</div>}
            {success && <div className="alert alert-success" style={{ marginBottom:4, padding:"6px 10px", fontSize:"0.8rem" }}>{success}</div>}
          </div>
          <div style={{ flex:1, overflow:"auto", padding:"0 16px" }}>
            {cart.length === 0 ? (
              <div style={{ textAlign:"center", padding:"3rem 1rem", color:"#94a3b8", fontSize:"0.85rem" }}>Cart is empty. Search items below.</div>
            ) : cart.map((item) => (
              <div key={item.id} style={{ padding:"10px 0", borderBottom:"1px solid #f1f5f9" }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:4 }}>
                  <div style={{ fontSize:"0.85rem", fontWeight:500, flex:1 }}>{item.name}</div>
                  <button onClick={() => handleRemove(item.id)} style={{ background:"none", border:"none", color:"#dc2626", cursor:"pointer", fontSize:"1rem", lineHeight:1, padding:"0 4px" }}>×</button>
                </div>
                <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                  <input type="number" className="input" style={{ width:60, padding:"0.25rem 0.4rem", fontSize:"0.8rem" }} value={item.qty} onChange={(e) => handleUpdateQty(item.id, parseFloat(e.target.value) || 0)} step="0.01" />
                  <span style={{ fontSize:"0.75rem", color:"#94a3b8" }}>×</span>
                  <input type="number" className="input" style={{ width:90, padding:"0.25rem 0.4rem", fontSize:"0.8rem" }} value={item.unit_price} onChange={(e) => handleUpdatePrice(item.id, parseFloat(e.target.value) || 0)} disabled={item.kind === "used_oil"} />
                  <div style={{ flex:1, textAlign:"right", fontWeight:600, fontSize:"0.85rem" }}>{currency(item.line_total)}</div>
                </div>
                {item.kind === "product" && (() => {
                  const pack = packLitres(item.product);
                  const lo = leftoverLitres(item);
                  const byCap = !!item.billByCapacity;
                  const toCont = !!item.leftoverToContainers;
                  const full = tierFullPrice(item);
                  const prorated = byCap && lo > 0 && Math.abs(full - item.unit_price) > 0.009;
                  return (
                    <div style={{ display:"flex", alignItems:"center", gap:8, marginTop:4, flexWrap:"wrap" }}>
                      <span style={{ fontSize:"0.68rem", color:"#94a3b8" }}>Pack {pack > 0 ? `${pack}L` : "-"}</span>
                      <span style={{ fontSize:"0.68rem", color:"#94a3b8" }}>Capacity</span>
                      <input type="number" className="input" placeholder={pack > 0 ? String(pack) : "L"} step="0.01" min="0"
                        style={{ width:72, padding:"0.15rem 0.4rem", fontSize:"0.72rem" }}
                        value={item.capacity ?? ""}
                        onChange={(e) => handleUpdateCapacity(item.id, parseFloat(e.target.value) || 0)} />
                      <span style={{ fontSize:"0.68rem", color:"#94a3b8" }}>L</span>
                      <label style={{ display:"flex", alignItems:"center", gap:4, fontSize:"0.68rem", color:"#64748b", cursor:"pointer" }}>
                        <input type="checkbox" checked={byCap} onChange={(e) => handleToggleBillByCapacity(item.id, e.target.checked)} />
                        Bill by capacity
                      </label>
                      <label style={{ display:"flex", alignItems:"center", gap:4, fontSize:"0.68rem", color:"#64748b", cursor:"pointer" }}>
                        <input type="checkbox" checked={toCont} onChange={(e) => handleToggleLeftoverToContainers(item.id, e.target.checked)} />
                        Leftover to containers
                      </label>
                      <span style={{ fontSize:"0.68rem", color: lo > 0 ? "#b45309" : "#94a3b8" }}>
                        {lo > 0 ? `leftover ${lo}L` : "no leftover"}
                      </span>
                      <span style={{ fontSize:"0.68rem", color: lo > 0 ? (toCont ? "#15803d" : "#64748b") : "#94a3b8" }}>
                        {lo > 0 ? (toCont ? "→ containers" : "→ customer takes it") : ""}
                      </span>
                      {prorated && (
                        <span style={{ fontSize:"0.68rem", color:"#0369a1" }}>
                          billed {item.capacity}L of {pack}L · {currency(full)} → {currency(item.unit_price)}
                        </span>
                      )}
                    </div>
                  );
                })()}
              </div>
            ))}
          </div>
          <div style={{ padding:"10px 16px", borderTop:"1px solid var(--color-border)" }}>
            <div style={{ display:"flex", gap:6, marginBottom:8, alignItems:"flex-start" }}>
              <input className="input" placeholder="Mileage" type="number" value={mileage || ""} onChange={(e) => setMileage(Number(e.target.value))} style={{ fontSize:"0.8rem", width:100 }} />
              <textarea className="input" placeholder="Notes (optional) - one note per line" value={notes} onChange={(e) => setNotes(e.target.value)}
                rows={2} style={{ fontSize:"0.8rem", flex:1, resize:"vertical", fontFamily:"inherit", lineHeight:1.4 }} />
            </div>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
              <span style={{ fontSize:"0.85rem", color:"#64748b" }}>Total</span>
              <span style={{ fontSize:"1.4rem", fontWeight:800, color:"var(--color-primary)" }}>{currency(total)}</span>
            </div>
            {canPrint && (
              <div style={{ borderTop:"1px dashed var(--color-border)", marginBottom:6 }}>
                <POSPrint cart={printItems} total={printTotal} customerName={printName} customerPhone={printPhone} orderId={printOrderId} notes={printNotes} vehicle={printVehicle} mileage={printMileage} />
              </div>
            )}
            <button onClick={handleComplete} className="btn btn-success btn-full btn-lg" disabled={cart.length === 0}>Complete Sale</button>
          </div>
        </div>
        {customerHistory && (
          <div style={{ width:280, display:"flex", flexDirection:"column", background:"#f8fafc", borderLeft:"1px solid var(--color-border)" }}>
            <div style={{ padding:"10px 12px", borderBottom:"1px solid var(--color-border)", background:"white" }}>
              <div style={{ fontWeight:600, fontSize:"0.85rem" }}>{customerHistory.customer.name}</div>
              <div style={{ fontSize:"0.7rem", color:"#64748b", marginTop:2 }}>
                {customerHistory.customer.phone && <span>{customerHistory.customer.phone} · </span>}
                <span style={{ textTransform:"capitalize" }}>{customerHistory.customer.customer_type}</span>
              </div>
              <div style={{ display:"flex", gap:12, marginTop:6, fontSize:"0.7rem" }}>
                <span style={{ color:"#16a34a" }}>Spent: {currency(customerHistory.totalSpent)}</span>
                {customerHistory.customer.credit_balance > 0 && <span style={{ color:"#dc2626" }}>Credit: {currency(customerHistory.customer.credit_balance)}</span>}
              </div>
            </div>
            <div style={{ flex:1, overflow:"auto", padding:"8px 12px" }}>
              <div style={{ fontSize:"0.7rem", fontWeight:600, color:"#64748b", textTransform:"uppercase", marginBottom:6 }}>Recent Orders</div>
              {customerHistory.orders.length === 0 ? (
                <div style={{ fontSize:"0.75rem", color:"#94a3b8" }}>No previous orders</div>
              ) : customerHistory.orders.map((order:any) => (
                <div key={order.id} style={{ borderBottom:"1px solid #e2e8f0" }}>
                  <button type="button" onClick={() => toggleOrder(order.id)}
                    style={{ display:"block", width:"100%", padding:"6px 0", border:"none", background:"transparent", cursor:"pointer", textAlign:"left", fontSize:"0.75rem" }}>
                    <div style={{ display:"flex", justifyContent:"space-between" }}>
                      <span>{expandedOrder === order.id ? "" : "▸"} #{order.id}</span>
                      <span style={{ fontWeight:600 }}>{currency(order.total)}</span>
                    </div>
                    <div style={{ color:"#94a3b8", fontSize:"0.65rem" }}>{new Date(order.created_at).toLocaleDateString()} · {order.item_count} item{order.item_count === 1 ? "" : "s"}</div>
                    {order.registration && (
                      <div style={{ color:"#94a3b8", fontSize:"0.65rem" }}>
                        🚗 {order.registration}{[order.make, order.model, order.model_year].filter(Boolean).length ? ` · ${[order.make, order.model, order.model_year].filter(Boolean).join(" ")}` : ""}{order.color ? ` · ${order.color}` : ""}
                      </div>
                    )}
                  </button>
                  {expandedOrder === order.id && (
                    <div style={{ padding:"2px 0 10px", fontSize:"0.7rem" }}>
                      {detailLoading ? (
                        <div style={{ color:"#94a3b8" }}>Loading…</div>
                      ) : (
                        <>
                          {orderDetail.map((it:any, k:number) => (
                            <div key={k} style={{ padding:"2px 0", borderBottom:"1px dotted #e2e8f0" }}>
                              <div style={{ display:"flex", justifyContent:"space-between", gap:8 }}>
                                <span style={{ flex:1 }}>{it.product_name}</span>
                                <span style={{ color:"#64748b", whiteSpace:"nowrap" }}>{it.qty} × {currency(it.unit_price)}</span>
                                <span style={{ fontWeight:600, whiteSpace:"nowrap" }}>{currency(it.line_total)}</span>
                              </div>
                              {Number(it.leftover_litres) > 0 && (
                                <div style={{ display:"flex", alignItems:"center", gap:6, marginTop:2, flexWrap:"wrap", color:"#94a3b8" }}>
                                  <span>
                                    Cap {it.capacity}L
                                    {it.billed_by_capacity ? ` · billed for ${it.capacity}L` : " · billed full bottle"}
                                    {" · "}{it.leftover_litres}L →
                                  </span>
                                  {it.leftover_released || it.leftover_to === "customer" ? (
                                    <span style={{ color:"#64748b" }}>customer took it</span>
                                  ) : it.billed_by_capacity ? (
                                    <span style={{ color:"#94a3b8" }}>containers (customer not charged for it)</span>
                                  ) : (
                                    <>
                                      <span style={{ color:"#15803d" }}>containers</span>
                                      <button type="button" onClick={() => giveLeftoverToCustomer(it)}
                                        style={{ fontSize:"0.62rem", padding:"1px 6px", borderRadius:3, cursor:"pointer", background:"#f1f5f9", color:"#475569", border:"1px solid #e2e8f0" }}>
                                        Give to customer
                                      </button>
                                    </>
                                  )}
                                </div>
                              )}
                              {Number(it.leftover_litres) === 0 && it.billed_by_capacity && Number(it.capacity) > 0 && (
                                <div style={{ marginTop:2, color:"#94a3b8" }}>Cap {it.capacity}L · billed by capacity</div>
                              )}
                            </div>
                          ))}
                          {orderDetail.length === 0 && <div style={{ color:"#94a3b8" }}>No line items</div>}
                          <div style={{ marginTop:6, display:"flex", flexWrap:"wrap", gap:10, color:"#64748b" }}>
                            <span style={{ textTransform:"capitalize" }}>Status: {order.status}</span>
                            {order.mileage > 0 && <span>Mileage: {order.mileage}</span>}
                            {order.vehicle_condition && <span>Condition: {order.vehicle_condition}</span>}
                          </div>
                          {order.notes && <div style={{ marginTop:2, color:"#64748b" }}>Notes: {order.notes}</div>}
                        </>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      <div style={{ padding:"10px 16px", borderTop:"1px solid var(--color-border)", background:"white" }}>
        <POSSearch onSelect={handleSearchSelect} customerType={customerType} />
        {lastSale && cart.length === 0 && (
          <div style={{ marginTop:8, display:"flex", alignItems:"center", gap:10 }}>
            <span style={{ fontSize:"0.75rem", color:"#16a34a" }}>Order #{lastSale.orderId} · {currency(lastSale.total)}</span>
            <button className="btn btn-ghost btn-sm" style={{ fontSize:"0.7rem" }} onClick={() => setLastSale(null)}>New Sale</button>
          </div>
        )}
      </div>
    </div>
  );
}


