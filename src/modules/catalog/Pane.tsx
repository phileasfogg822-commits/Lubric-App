import type { ReactNode } from "react";

interface Props {
  icon: string;
  label: string;
  count?: number;
  /** Optional right-aligned controls (filters, "View all →"). */
  tools?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}

/** Consistent section chrome for each entity on the Catalog page. */
export function Pane({ icon, label, count, tools, action, children }: Props) {
  return (
    <section style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: "1rem", color: "#94a3b8" }}>{icon}</span>
        <span style={{ fontWeight: 700, fontSize: "0.9rem" }}>{label}</span>
        {count !== undefined && <span className="badge badge-gray">{count}</span>}
        <div style={{ flex: 1 }} />
        {tools}
        {action}
      </div>
      {children}
    </section>
  );
}