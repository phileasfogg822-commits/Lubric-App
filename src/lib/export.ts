/** Client-side CSV export: builds a file and triggers a download. No dependencies. */
export function downloadCSV(filename: string, headers: string[], rows: (string | number | null | undefined)[][]): void {
  const esc = (v: string | number | null | undefined) => {
    const s = v == null ? "" : String(v);
    // Quote when the value contains a comma, quote or newline; double any quotes.
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.map(esc).join(","), ...rows.map((r) => r.map(esc).join(","))];
  // \uFEFF BOM so Excel opens UTF-8 names (Urdu/Arabic) correctly.
  const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  // Timestamped so repeated exports never prompt to overwrite the previous file.
  a.download = stampFilename(filename);
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** "2026-09-22 1430" — date + time, colon-free so the stamp is safe in a Windows filename. */
export function printStamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}${p(d.getMinutes())}`;
}

/** Strip characters Windows/browsers refuse in filenames and collapse whitespace. */
function sanitizePart(v: string): string {
  return v.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim();
}

/** Insert a unique stamp before the extension: "customers.csv" → "customers 2026-09-22 1430.csv". */
export function stampFilename(filename: string): string {
  const dot = filename.lastIndexOf(".");
  const stem = dot > 0 ? filename.slice(0, dot) : filename;
  const ext = dot > 0 ? filename.slice(dot) : "";
  return `${sanitizePart(stem)} ${printStamp()}${ext}`;
}

/**
 * Point the print dialog's suggested filename at real content instead of the
 * static app title ("Lubric POS"). Chrome/Edge use document.title as the
 * default "Save as PDF" name, so every export used to collide on
 * "Lubric POS.pdf" and prompt to overwrite. Parts are joined with " - ",
 * sanitized for filesystems, and the tab title is restored once printing is
 * done (afterprint also fires when the dialog is cancelled).
 *
 * Returns a restore() fallback to call right after window.print() returns —
 * it is a no-op if afterprint already ran.
 */
export function setPrintFilename(...parts: (string | number | null | undefined)[]): () => void {
  const prev = document.title;
  const name = parts
    .map((p) => sanitizePart(p == null ? "" : String(p)))
    .filter(Boolean)
    .join(" - ");
  if (!name) return () => {};
  document.title = name;
  let done = false;
  const restore = () => {
    if (done) return;
    done = true;
    document.title = prev;
    window.removeEventListener("afterprint", restore);
  };
  window.addEventListener("afterprint", restore);
  return restore;
}

/**
 * Print-to-PDF for reports/statements: renders `#report-print-root` as the only
 * visible content and opens the browser print dialog (Save as PDF). Mirrors the
 * POSPrint approach — no PDF library needed.
 *
 * `parts` name the file in the print dialog (report title, entity, period...);
 * a timestamp is appended so repeated exports never collide.
 */
export function printReport(...parts: (string | number | null | undefined)[]): void {
  const restoreTitle = setPrintFilename(...parts, printStamp());
  document.body.setAttribute("data-report-print", "1");
  // Inject the A4 page rule at print time so it never clashes with the POS
  // receipt page sizes, which are injected per print as well.
  const style = document.createElement("style");
  style.id = "report-page-rule";
  style.textContent = "@page { size: A4 portrait; margin: 12mm; }";
  document.head.appendChild(style);
  const cleanup = () => {
    restoreTitle();
    document.body.removeAttribute("data-report-print");
    document.getElementById("report-page-rule")?.remove();
    window.removeEventListener("afterprint", cleanup);
  };
  window.addEventListener("afterprint", cleanup);
  window.print();
  restoreTitle();
}
