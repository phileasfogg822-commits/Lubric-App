import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import pool from "./db.js";

const T = (s) => console.log("\n=== " + s + " ===");

T("1. ADMIN PASSWORD RESET");
const password = "Lubric-" + crypto.randomBytes(6).toString("hex");
const hash = await bcrypt.hash(password, 10);
const upd = await pool.query(
  "UPDATE users SET password_hash=$1 WHERE email=$2 RETURNING id,email,full_name,role",
  [hash, "admin@lubric.app"]
);
if (upd.rows.length === 0) { console.log("ERROR: admin user not found"); process.exit(1); }
console.log("EMAIL:    " + upd.rows[0].email);
console.log("NAME:     " + upd.rows[0].full_name);
console.log("ROLE:     " + upd.rows[0].role);
console.log("PASSWORD: " + password);
console.log("(shown once - save it now, you can change it in the app later)");

T("2. CASHIER PASSWORD RESET");
const cp = "Counter-" + crypto.randomBytes(5).toString("hex");
const cHash = await bcrypt.hash(cp, 10);
const cUpd = await pool.query(
  "UPDATE users SET password_hash=$1 WHERE email=$2 RETURNING id,email,full_name,role",
  [cHash, "cashier@lubric.app"]
);
if (cUpd.rows.length) {
  console.log("EMAIL:    " + cUpd.rows[0].email);
  console.log("ROLE:     " + cUpd.rows[0].role);
  console.log("PASSWORD: " + cp);
}

T("3. DEVICE PAIRING CODES");
const wanted = [["desktop", "Front counter PC"], ["mobile", "Field phone"]];
for (const pair of wanted) {
  const kind = pair[0];
  const name = pair[1];
  const code = crypto.randomBytes(4).toString("hex").toUpperCase();
  const r = await pool.query(
    "INSERT INTO devices (shop_id,kind,name,pairing_code) VALUES (1,$1,$2,$3) RETURNING id",
    [kind, name, code]
  );
  console.log(kind.toUpperCase() + "  #" + r.rows[0].id + "  " + name + "  ->  " + code);
}
console.log("\nEach code is single-use. Enter it in the app, then it gets a permanent token.");

await pool.end();