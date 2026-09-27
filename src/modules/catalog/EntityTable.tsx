import type { ReactNode } from "react";
import type { Column } from "./columns";
import type { Density } from "./prefs";
import { densityPad } from "./prefs";

interface Props {
  columns: Column[];
  rows: any[];
  density: Density;
  loading?: boolean;
  /** Extra trailing actions cell, e.g. Edit / Mark empty. */
  actions?: (row: any) => ReactNode;
  actionsLabel?: string;
  onRowClick?: (row: any) => void;
  /** Dim rows that are inactive / empty. */
  isDimmed?: (row: any) => boolean;
  empty?: ReactNode;
}

export default function EntityTable({
  columns, rows, density, loading, actions, actionsLabel, onRowClick, isDimmed, empty,
}: Props) {
  if (loading) return <div style={{ textAlign: "center", padding: 32, color: "var(--color-muted)" }}>Loading…</div>;
  if (!rows.length) return <div style={{ padding: "1.5rem 0" }}>{empty}</div>;

  const pad = densityPad(density);

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} style={{ textAlign: c.align ?? "left" }}>{c.label}</th>
            ))}
            {actions && <th style={{ textAlign: "right", width: 1 }}>{actionsLabel ?? ""}</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={row.id ?? i}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              style={{
                opacity: isDimmed?.(row) ? 0.45 : 1,
                cursor: onRowClick ? "pointer" : undefined,
              }}
            >
              {columns.map((c) => (
                <td
                  key={c.key}
                  style={{ textAlign: c.align ?? "left", padding: pad, whiteSpace: c.align ? "nowrap" : undefined }}
                >
                  {c.render(row)}
                </td>
              ))}
              {actions && (
                <td style={{ padding: pad, textAlign: "right", whiteSpace: "nowrap" }} onClick={(e) => e.stopPropagation()}>
                  {actions(row)}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}