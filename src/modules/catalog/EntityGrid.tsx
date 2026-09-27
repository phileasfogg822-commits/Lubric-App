import type { ReactNode } from "react";
import type { Column } from "./columns";
import type { Density } from "./prefs";
import { densityCardWidth } from "./prefs";

interface Props {
  /** Designated title field for the card (always shown, even if the column is unchecked). */
  title: Column;
  /** Remaining visible card fields. */
  columns: Column[];
  rows: any[];
  density: Density;
  loading?: boolean;
  actions?: (row: any) => ReactNode;
  onRowClick?: (row: any) => void;
  isDimmed?: (row: any) => boolean;
  empty?: ReactNode;
}

export default function EntityGrid({
  title, columns, rows, density, loading, actions, onRowClick, isDimmed, empty,
}: Props) {
  if (loading) return <div style={{ textAlign: "center", padding: 32, color: "var(--color-muted)" }}>Loading…</div>;
  if (!rows.length) return <div style={{ padding: "1.5rem 0" }}>{empty}</div>;

  const min = densityCardWidth(density);
  const compact = density === "s";

  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${min}px, 1fr))`, gap: compact ? 8 : 12 }}>
      {rows.map((row, i) => (
        <div
          key={row.id ?? i}
          className="catalog-card"
          onClick={onRowClick ? () => onRowClick(row) : undefined}
          style={{
            opacity: isDimmed?.(row) ? 0.45 : 1,
            cursor: onRowClick ? "pointer" : undefined,
            padding: compact ? 8 : 12,
          }}
        >
          <div style={{ fontSize: compact ? "0.8rem" : "0.9rem", fontWeight: 600, marginBottom: compact ? 4 : 8, lineHeight: 1.25 }}>
            {title.render(row)}
          </div>

          {columns.map((c) => (
            <div
              key={c.key}
              style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: compact ? "0.7rem" : "0.76rem", padding: "1px 0" }}
            >
              <span style={{ color: "#94a3b8", flexShrink: 0 }}>{c.label}</span>
              <span style={{ fontWeight: 500, textAlign: "right", overflowWrap: "anywhere" }}>{c.render(row)}</span>
            </div>
          ))}

          {actions && (
            <div style={{ display: "flex", gap: 6, marginTop: compact ? 6 : 10 }} onClick={(e) => e.stopPropagation()}>
              {actions(row)}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}