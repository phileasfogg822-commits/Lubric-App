import React from "react";

interface ModalProps {
  open?: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}

export function Modal({ open = true, onClose, title, children, footer, wide }: ModalProps) {
  if (!open) return null;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={wide ? { maxWidth: 720 } : undefined}>
        <div className="modal-title">{title}</div>
        {children}
        {footer && <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>{footer}</div>}
      </div>
    </div>
  );
}
