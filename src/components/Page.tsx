import React from "react";

interface PageProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}

export function Page({ title, subtitle, actions, action, children }: PageProps) {
  return (
    <div style={{ padding: "1.5rem", height: "100%", overflow: "auto" }}>
      <div className="page-header">
        <div className="page-actions">
          <div>
            <h1 className="page-title">{title}</h1>
            {subtitle && <div className="page-subtitle">{subtitle}</div>}
          </div>
          {(actions || action) && <div style={{ display: "flex", gap: 8 }}>{actions || action}</div>}
        </div>
      </div>
      {children}
    </div>
  );
}
