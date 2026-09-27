import { useEffect, useState } from "react";
import type { CartItem } from "../../lib/types";
import { currency } from "../../lib/format";
import { dbGet } from "../../lib/db";
import { printStamp, setPrintFilename } from "../../lib/export";
import type { SaleVehicle } from "./POSCart";

type PrintFormat = "a4" | "a5" | "receipt" | "receipt_3inch";

interface Props {
  cart: CartItem[];
  total: number;
  customerName: string;
  customerPhone?: string;
  orderId: number;
  notes: string;
  /** Odometer reading captured with the sale (km); printed when > 0. */
  mileage?: number;
  vehicle?: SaleVehicle | null;
}

interface ShopInfo { name: string; address: string; phone: string; currency: string; }

const FALLBACK_SHOP: ShopInfo = { name: "Lubric POS", address: "", phone: "", currency: "PKR" };

// @page rules injected at print time so the paper size matches the chosen format.
// A4/A5 are for sheet printers; 80mm is a standard grocery thermal roll and
// 72mm covers the narrower "3 inch" thermal printers.
const PAGE_RULES: Record<PrintFormat, string> = {
  a4: "@page { size: A4 portrait; margin: 12mm; }",
  a5: "@page { size: A5 portrait; margin: 8mm; }",
  receipt: "@page { size: 80mm auto; margin: 2mm; }",
  receipt_3inch: "@page { size: 72mm auto; margin: 1mm; }",
};

// Clean labels for the exported filename (the button's `3"` label would need
// sanitising anyway, so name the paper size instead).
const FORMAT_LABEL: Record<PrintFormat, string> = {
  a4: "A4",
  a5: "A5",
  receipt: "Receipt 80mm",
  receipt_3inch: "Receipt 72mm",
};

export default function POSPrint({ cart, total, customerName, customerPhone, orderId, notes, vehicle, mileage = 0 }: Props) {
  const [shop, setShop] = useState<ShopInfo>(FALLBACK_SHOP);

  // Pull the real shop identity from the DB so receipts carry the business name.
  useEffect(() => {
    let alive = true;
    dbGet<ShopInfo>("SELECT name, address, phone, currency FROM shops WHERE id = 1")
      .then((row) => { if (alive && row) setShop({ ...FALLBACK_SHOP, ...row }); })
      .catch(() => { /* keep the fallback */ });
    return () => { alive = false; };
  }, []);

  const now = new Date();
  const dateStr = now.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  const timeStr = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

  function handlePrint(format: PrintFormat) {
    // Suggest a content-based filename in the print dialog (document.title is
    // the "Save as PDF" name): bill number, customer and paper format, stamped
    // so exports never collide with a previous "Lubric POS.pdf".
    const restoreTitle = setPrintFilename(
      "Invoice",
      orderId > 0 ? `#${orderId}` : "Draft",
      customerName || "Walk-in",
      FORMAT_LABEL[format],
      printStamp(),
    );
    document.body.setAttribute("data-print-format", format);
    const style = document.createElement("style");
    style.textContent = PAGE_RULES[format];
    document.head.appendChild(style);
    setTimeout(() => {
      window.print();
      restoreTitle();
      document.body.removeAttribute("data-print-format");
      style.remove();
    }, 100);
  }

  return (
    <div className="pos-print">
      <div className="print-a4" style={{ display: "none" }}>
        <div style={{ fontFamily: "Arial, sans-serif", maxWidth: 800, margin: "0 auto", padding: 40 }}>
          <div style={{ textAlign: "center", borderBottom: "2px solid #333", paddingBottom: 16, marginBottom: 24 }}>
            <h1 style={{ margin: 0, fontSize: 24 }}>{shop.name}</h1>
            {shop.address && <p style={{ margin: "4px 0", fontSize: 13, color: "#666" }}>{shop.address}</p>}
            {shop.phone && <p style={{ margin: "4px 0", fontSize: 13, color: "#666" }}>Tel: {shop.phone}</p>}
          </div>
          <div style={{ marginBottom: 20, fontSize: 13 }}>
            <p><strong>Invoice #:</strong> {orderId > 0 ? orderId : "DRAFT"} &nbsp;&nbsp; <strong>Date:</strong> {dateStr} {timeStr}</p>
            <p><strong>Customer:</strong> {customerName || "Walk-in"}{customerPhone && <span> · {customerPhone}</span>}</p>
            {vehicle && (vehicle.registration || vehicle.make || vehicle.model) && (
              <p style={{ marginTop: 4 }}>
                <strong>Vehicle:</strong>{" "}
                {[
                  vehicle.registration,
                  [vehicle.make, vehicle.model, vehicle.modelYear].filter(Boolean).join(" "),
                  vehicle.color,
                ].filter(Boolean).join(" · ")}
              </p>
            )}
            {mileage > 0 && <p style={{ marginTop: 4 }}><strong>Mileage:</strong> {mileage.toLocaleString()} km</p>}
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 20, fontSize: 13 }}>
            <thead><tr style={{ borderBottom: "2px solid #333" }}>
              <th style={{ textAlign: "left", padding: "8px 4px" }}>Item</th>
              <th style={{ textAlign: "center", padding: "8px 4px" }}>Qty</th>
              <th style={{ textAlign: "right", padding: "8px 4px" }}>Price</th>
              <th style={{ textAlign: "right", padding: "8px 4px" }}>Total</th>
            </tr></thead>
            <tbody>{cart.map((item) => (
              <tr key={item.id} style={{ borderBottom: "1px solid #eee" }}>
                <td style={{ padding: "6px 4px" }}>{item.name}</td>
                <td style={{ textAlign: "center", padding: "6px 4px" }}>{item.qty}</td>
                <td style={{ textAlign: "right", padding: "6px 4px" }}>{currency(item.unit_price)}</td>
                <td style={{ textAlign: "right", padding: "6px 4px" }}>{currency(item.line_total)}</td>
              </tr>
            ))}</tbody>
          </table>
          <div style={{ borderTop: "2px solid #333", paddingTop: 12, textAlign: "right" }}>
            <p style={{ fontSize: 18, fontWeight: "bold", margin: 0 }}>Total: {currency(total)}</p>
          </div>
          {notes && <p style={{ fontSize: 12, color: "#666", marginTop: 16 }}>Notes: {notes}</p>}
          <p style={{ fontSize: 11, color: "#999", textAlign: "center", marginTop: 30 }}>Thank you!</p>
        </div>
      </div>

      <div className="print-receipt" style={{ display: "none" }}>
        <div style={{ fontFamily: "Courier New, monospace", fontSize: 11, width: "72mm", boxSizing: "border-box", overflowWrap: "break-word", margin: "0 auto", padding: "4px 2px" }}>
          <div style={{ textAlign: "center", borderBottom: "1px dashed #999", paddingBottom: 8, marginBottom: 8 }}>
            <strong style={{ fontSize: 13 }}>{shop.name}</strong>
            {shop.address && <div style={{ fontSize: 9, marginTop: 2 }}>{shop.address}</div>}
            {shop.phone && <div style={{ fontSize: 9 }}>Tel: {shop.phone}</div>}
          </div>
          <div style={{ fontSize: 9, marginBottom: 6 }}>
            <div>{orderId > 0 ? "#" + orderId : "DRAFT"} | {dateStr}</div>
            <div>{timeStr} | {customerName || "Walk-in"}{customerPhone ? ` · ${customerPhone}` : ""}</div>
            {vehicle?.registration && (
              <div>
                {[vehicle.registration, vehicle.make, vehicle.model, vehicle.modelYear].filter(Boolean).join(" ")}
                {vehicle.color ? ` | ${vehicle.color}` : ""}
              </div>
            )}
            {mileage > 0 && <div>Mileage: {mileage.toLocaleString()} km</div>}
          </div>
          <div style={{ borderTop: "1px dashed #999", borderBottom: "1px dashed #999", padding: "4px 0", marginBottom: 6 }}>
            {cart.map((item) => (
              <div key={item.id} style={{ marginBottom: 3 }}>
                <div style={{ fontWeight: "bold" }}>{item.name}</div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>{item.qty} x {currency(item.unit_price)}</span>
                  <span>{currency(item.line_total)}</span>
                </div>
              </div>
            ))}
          </div>
          <div style={{ textAlign: "right", fontWeight: "bold", fontSize: 13, marginBottom: 8 }}>TOTAL: {currency(total)}</div>
          <div style={{ textAlign: "center", fontSize: 9, borderTop: "1px dashed #999", paddingTop: 6 }}>Thank you!</div>
        </div>
      </div>

      <div className="print-receipt-3inch" style={{ display: "none" }}>
        <div style={{ fontFamily: "Courier New, monospace", fontSize: 10, width: "64mm", boxSizing: "border-box", overflowWrap: "break-word", margin: "0 auto", padding: "4px 2px" }}>
          <div style={{ textAlign: "center", borderBottom: "1px dashed #999", paddingBottom: 6, marginBottom: 6 }}>
            <strong style={{ fontSize: 11 }}>{shop.name}</strong>
            {shop.phone && <div style={{ fontSize: 8 }}>{shop.phone}</div>}
          </div>
          <div style={{ fontSize: 8, marginBottom: 4 }}>{orderId > 0 ? "#" + orderId : "DRAFT"} {dateStr} {timeStr}</div>
          <div style={{ fontSize: 8, marginBottom: 2 }}>{customerName || "Walk-in"}</div>
          {customerPhone && <div style={{ fontSize: 8, marginBottom: 2 }}>{customerPhone}</div>}
          {mileage > 0 && <div style={{ fontSize: 8, marginBottom: 2 }}>Mileage: {mileage.toLocaleString()} km</div>}
          {vehicle?.registration && (
            <div style={{ fontSize: 8, marginBottom: 4 }}>
              {[vehicle.registration, vehicle.make, vehicle.model, vehicle.modelYear].filter(Boolean).join(" ")}
              {vehicle.color ? ` ${vehicle.color}` : ""}
            </div>
          )}
          <div style={{ borderTop: "1px dashed #999", paddingTop: 4 }}>
            {cart.map((item) => (
              <div key={item.id} style={{ marginBottom: 2 }}>
                <div>{item.name.length > 20 ? item.name.slice(0, 18) + ".." : item.name}</div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>{item.qty}x{item.unit_price}</span>
                  <span>{currency(item.line_total)}</span>
                </div>
              </div>
            ))}
          </div>
          <div style={{ borderTop: "1px dashed #999", marginTop: 4, paddingTop: 4, textAlign: "right", fontWeight: "bold", fontSize: 11 }}>{currency(total)}</div>
        </div>
      </div>

      <div className="print-controls">
        <div style={{ display: "flex", gap: 6, alignItems: "center", padding: "8px 0" }}>
          <span style={{ fontSize: "0.75rem", color: "#64748b" }}>Print:</span>
          {([["a4", "A4"], ["a5", "A5"], ["receipt", "Receipt"], ["receipt_3inch", "3\""]] as [PrintFormat, string][]).map(([fmt, label]) => (
            <button key={fmt} onClick={() => handlePrint(fmt)} className="btn btn-ghost btn-sm" style={{ fontSize: "0.75rem" }}>{label}</button>
          ))}
        </div>
      </div>
    </div>
  );
}
