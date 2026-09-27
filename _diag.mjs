import { readFileSync, writeFileSync } from "fs";

const s = readFileSync("src/components/Layout.tsx", "utf8");
const log = [];
const codes = (t) => t.split("").map((c) => c.charCodeAt(0)).join(",");
const named = (t) => t.split("").map((c) => (c === '"' ? "Q" : c === "\\" ? "BS" : c)).join("|");

const j = s.indexOf("{ to: ");
log.push("index of '{ to: ' = " + j);
log.push("codes = " + codes(s.slice(j, j + 34)));
log.push("named = " + named(s.slice(j, j + 34)));

log.push("line1 codes = " + codes(s.split("\n")[0]));
log.push("line1 named = " + named(s.split("\n")[0]));

log.push("has backslash-quote = " + s.includes("\\" + String.fromCharCode(34)));
log.push("backslash count = " + (s.match(/\\/g) || []).length);
log.push("quote count = " + (s.match(/"/g) || []).length);

writeFileSync("_patchlog.txt", log.join("\n") + "\n", "utf8");
console.log("ok");
