import { readFileSync, writeFileSync } from "fs";

const p = "src/components/Layout.tsx";
let s = readFileSync(p, "utf8");
const log = [];

// 1. Drop the dead adminOnly reference — the NAV no longer has that field, so
//    `item.adminOnly` is a TypeScript error, and the permission check below it
//    is the only gate that matters now.
const beforeGuard = s;
s = s.replace(/^\s*\/\/ Admin-only items\s*\r?\n/m, "");
s = s.replace(/^\s*if \(item\.adminOnly[^\n]*\r?\n/m, "");
s = s.replace(/if \(!item\.adminOnly && item\.permission/g, "if (item.permission");
log.push("guard cleaned: " + (s !== beforeGuard));
log.push("adminOnly left: " + s.includes("adminOnly"));

// 2. Add Reports to the sidebar, straight after Sales History.
const anchor = 'permission: "sales_history"';
const i = s.indexOf(anchor);
log.push("anchor found: " + (i !== -1));
if (i !== -1 && !s.includes('"/reports"')) {
  const nl = s.indexOf("\n", i);
  // "\\u{1F4C8}" is written literally so this patch file stays ASCII-safe.
  const entry = '\n  { to: "/reports", label: "Reports", icon: "\\u{1F4C8}", permission: "reports" },';
  s = s.slice(0, nl) + entry + s.slice(nl);
}
log.push("reports added: " + s.includes('"/reports"'));

writeFileSync(p, s);

// 3. Sanity: the file must still hold every original nav entry plus the new one.
log.push("nav entries: " + (s.match(/\{ to: /g) || []).length);
writeFileSync("_patchlog.txt", log.join("\n") + "\n", "utf8");
