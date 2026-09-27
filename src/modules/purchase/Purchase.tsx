import { Page } from "../../components/Page";

export default function Purchase() {
  return (
    <Page title="Purchase Orders">
      <div style={{ textAlign: "center", padding: "60px 20px", color: "#64748b" }}>
        <div style={{ fontSize: "3rem", marginBottom: 16 }}>🛒</div>
        <div style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: 8 }}>Purchase Orders</div>
        <p>This module is coming soon. It will allow you to create purchase orders from vendors and track deliveries.</p>
      </div>
    </Page>
  );
}
