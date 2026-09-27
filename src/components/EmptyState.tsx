import React from "react";

interface EmptyStateProps {
  title: string;
  message?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
}

export function EmptyState({ title, message, icon, action }: EmptyStateProps) {
  return (
    <div className="empty-state">
      {icon || (
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M19 5v14H5V5h14m0-2H5c-1.1 0-2 .9-2 2v14a2 2 0 0 0 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 7H7v2h5v-2zm5 4H7v2h10v-2zm0-8H7v2h10V8z" />
        </svg>
      )}
      <h3>{title}</h3>
      {message && <p>{message}</p>}
      {action && <div style={{ marginTop: 16 }}>{action}</div>}
    </div>
  );
}
