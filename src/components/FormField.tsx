import React from "react";

interface FieldProps {
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}

export function FormField({ label, required, error, children }: FieldProps) {
  return (
    <div className="form-group">
      <label className="label">
        {label}
        {required && <span style={{ color: "red" }}> *</span>}
      </label>
      {children}
      {error && <div style={{ color: "red", fontSize: "0.75rem", marginTop: 4 }}>{error}</div>}
    </div>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`input ${props.className ?? ""}`} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`input ${props.className ?? ""}`} />;
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`input ${props.className ?? ""}`} />;
}
