export function currency(n: number | null | undefined, currency = "PKR"): string {
  if (n == null) return `${currency} 0.00`;
  return `${currency} ${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

export function dt(s: string | null | undefined): string {
  if (!s) return "—";
  const d = new Date(s.replace(" ", "T") + (s.includes("Z") ? "" : "Z"));
  if (isNaN(d.getTime())) return s;
  return d.toLocaleString();
}

export function d(s: string | null | undefined): string {
  if (!s) return "—";
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleDateString();
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}
