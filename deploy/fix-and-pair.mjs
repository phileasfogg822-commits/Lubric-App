import crypto from "node:crypto";
import pool from "./db.js";

const REPAIR = `
DO $fix$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['devices', 'cash_movements', 'reservations'] LOOP
    EXECUTE format('CREATE SEQUENCE IF NOT EXISTS %I_id_seq', t);
    EXECUTE format('ALTER TABLE %I ALTER COLUMN id SET DEFAULT nextval(%L)', t, t || '_id_seq');
    EXECUTE format('SELECT setval(%L, GREATEST(COALESCE((SELECT MAX(id) FROM %I), 0) + 1, 1), false)', t || '_id_seq', t);
  END LOOP;
END
$fix$;
`;

console.log("=== 1. APPLYING SEQUENCE REPAIR ===");
await pool.query(REPAIR);
console.log("repair applied");

console.log("");
console.log("=== 2. VERIFYING id DEFAULTS ===");
for (const t of ["devices", "cash_movements", "reservations"]) {
  const r = await pool.query("SELECT column_default FROM information_schema.columns WHERE table_name=$1 AND column_name=$2", [t, "id"]);
  const d = r.rows[0] && r.rows[0].column_default;
  console.log("  " + t + " -> " + (d ? "OK  " + d : "STILL BROKEN"));
}

console.log("");
console.log("=== 3. SMOKE TEST (insert then delete) ===");
const tmp = crypto.randomUUID();
await pool.query("INSERT INTO cash_movements (uuid, shop_id, kind, amount, note) VALUES ($1,1,$2,0,$3)", [tmp, "adjustment", "smoke-test"]);
const got = await pool.query("SELECT id FROM cash_movements WHERE uuid=$1", [tmp]);
console.log("  auto id assigned = " + got.rows[0].id);
await pool.query("DELETE FROM cash_movements WHERE uuid=$1", [tmp]);
console.log("  test row removed");

console.log("");
console.log("=== 4. DEVICE PAIRING CODES ===");
const wanted = [["desktop", "Front counter PC"], ["mobile", "Field phone"]];
for (const p of wanted) {
  const code = crypto.randomBytes(4).toString("hex").toUpperCase();
  const r = await pool.query("INSERT INTO devices (shop_id,kind,name,pairing_code) VALUES (1,$1,$2,$3) RETURNING id", [p[0], p[1], code]);
  console.log("  " + p[0].toUpperCase() + "  #" + r.rows[0].id + "  " + p[1] + "  ->  " + code);
}
console.log("");
console.log("  Single-use codes. Enter once in the app.");
await pool.end();