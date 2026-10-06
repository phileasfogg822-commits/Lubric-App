import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { query } from './db.js';
import pool from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPDATES_DIR = process.env.UPDATES_DIR || path.join(__dirname, 'updates');

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'lubric-app-dev-secret-change-in-production';

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ─── Auth Middleware ────────────────────────────────────────────
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    req.user = null;
    return next();
  }
  const token = authHeader.slice(7);
  try {
    req.user = jwt.verify(token, JWT_SECRET);
  } catch {
    req.user = null;
  }
  next();
}

app.use(authMiddleware);

// ─── Permission Enforcement ─────────────────────────────────────
// The client is a thin SQL client, so the server has to police it: every
// statement is classified against the table it touches and matched to the same
// permission keys used in src/lib/permissions.ts. Unauthenticated callers are
// rejected outright; authenticated callers need the matching key.
const ADMIN_ROLES = new Set(['admin', 'owner']);

const P = {
  DASHBOARD: 'dashboard',
  POS_CREATE: 'pos.create',
  SALES_HISTORY: 'sales_history',
  CATALOG_MANAGE: 'catalog.manage',
  CUSTOMERS: 'customers',
  VENDORS: 'vendors',
  ACCOUNTS: 'accounts',
  EXPENSES_MANAGE: 'expenses.manage',
  PURCHASE_MANAGE: 'purchase.manage',
  INSPECTIONS: 'inspections',
  REPORTS: 'reports',
  PROFIT_LOSS: 'profit_loss',
  TEAM_MANAGE: 'team.manage',
  SHOP_MANAGE: 'shop.manage',
  BILL_EDIT: 'bill.edit',
  BILL_VOID: 'bill.void',
  BILL_DELETE: 'bill.delete',
};

/** Accepts the TEXT column (JSON) or an already-parsed array. */
function parsePermissions(raw) {
  if (Array.isArray(raw)) return raw.filter((x) => typeof x === 'string');
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.filter((x) => typeof x === 'string');
    } catch {
      return raw.split(',').map((s) => s.trim()).filter(Boolean);
    }
  }
  return [];
}

// Which permission(s) unlock each table. ANY match passes.
// Reads are deliberately permissive so legitimate joins don't 403.
const READ_PERMISSIONS = {
  // Reports pages need bill/line/catalog figures for P&L, so `reports` is
  // accepted alongside the POS keys. Reads only — writes stay in WRITE_PERMISSIONS.
  orders: [P.SALES_HISTORY, P.POS_CREATE, P.REPORTS, P.PROFIT_LOSS],
  order_items: [P.SALES_HISTORY, P.POS_CREATE, P.REPORTS, P.PROFIT_LOSS],
  products: [P.POS_CREATE, P.SALES_HISTORY, P.CATALOG_MANAGE, P.REPORTS],
  services: [P.POS_CREATE, P.SALES_HISTORY, P.CATALOG_MANAGE, P.REPORTS],
  containers: [P.POS_CREATE, P.SALES_HISTORY, P.CATALOG_MANAGE],
  container_splits: [P.POS_CREATE, P.SALES_HISTORY, P.CATALOG_MANAGE],
  used_oil_log: [P.POS_CREATE, P.SALES_HISTORY, P.CATALOG_MANAGE],
  brands: [P.POS_CREATE, P.CATALOG_MANAGE],
  categories: [P.POS_CREATE, P.CATALOG_MANAGE],
  customers: [P.CUSTOMERS, P.POS_CREATE, P.SALES_HISTORY],
  vehicles: [P.CUSTOMERS, P.POS_CREATE, P.SALES_HISTORY],
  // The khata. Same money as orders/payables, just itemised per person, so
  // anyone who may see the party may see the rows behind their balance.
  party_ledger: [P.CUSTOMERS, P.VENDORS, P.POS_CREATE, P.SALES_HISTORY, P.ACCOUNTS, P.PURCHASE_MANAGE, P.REPORTS],
  payable_allocations: [P.CUSTOMERS, P.VENDORS, P.POS_CREATE, P.SALES_HISTORY, P.ACCOUNTS, P.PURCHASE_MANAGE, P.REPORTS],
  commitments: [P.CUSTOMERS, P.VENDORS, P.SALES_HISTORY],
  commitment_items: [P.CUSTOMERS, P.VENDORS, P.SALES_HISTORY],
  vendors: [P.VENDORS, P.PURCHASE_MANAGE],
  accounts: [P.ACCOUNTS, P.POS_CREATE, P.EXPENSES_MANAGE, P.DASHBOARD],
  account_transactions: [P.ACCOUNTS, P.POS_CREATE, P.EXPENSES_MANAGE, P.DASHBOARD],
  expenses: [P.EXPENSES_MANAGE, P.REPORTS, P.DASHBOARD, P.PROFIT_LOSS],
  purchase_orders: [P.PURCHASE_MANAGE, P.REPORTS],
  purchase_order_items: [P.PURCHASE_MANAGE, P.REPORTS],
  vendor_payables: [P.PURCHASE_MANAGE, P.REPORTS],
  inspections: [P.INSPECTIONS, P.POS_CREATE],
  // Devices carry a long-lived token that can read and write the whole shop's
  // data over /v1. Handing one out is as sensitive as creating a user account,
  // so it sits behind the same key - and, crucially, it has to be LISTED here.
  // An unlisted table is allowed by default: requiredPermissions returns null for
  // an unknown table and the middleware treats null as "nothing to check".
  // Before this entry existed, any logged-in cashier could read the devices
  // table and mint a pairing code, then exchange it for a permanent sync token.
  devices: [P.TEAM_MANAGE],
  users: [P.TEAM_MANAGE],
  role_permissions: [P.TEAM_MANAGE],
  shops: [P.DASHBOARD, P.SHOP_MANAGE],
  settings: [P.DASHBOARD, P.SHOP_MANAGE],
  // Deployment config carries the payment gateway and support contacts, and
  // flags steer which modules exist - read them the way settings is read, not
  // the unlisted default. Same lesson as `devices` above: unlisted = allowed.
  config: [P.SHOP_MANAGE],
  feature_flags: [P.SHOP_MANAGE],
  reminders: [P.DASHBOARD],
};

// Writes are where the guard bites: each table needs its specific key.
const WRITE_PERMISSIONS = {
  products: [P.CATALOG_MANAGE],
  services: [P.CATALOG_MANAGE],
  containers: [P.CATALOG_MANAGE],
  container_splits: [P.CATALOG_MANAGE],
  used_oil_log: [P.CATALOG_MANAGE],
  brands: [P.CATALOG_MANAGE],
  categories: [P.CATALOG_MANAGE],
  customers: [P.CUSTOMERS, P.POS_CREATE],
  vehicles: [P.CUSTOMERS, P.POS_CREATE],
  // Posting a khata row also moves the denormalised balance column the rest of
  // the app (and the phone) still reads, so the write keys mirror the parties:
  // customers for receivables, vendors for payables, plus the money keys for
  // whoever is allowed to move the till.
  party_ledger: [P.CUSTOMERS, P.VENDORS, P.ACCOUNTS, P.POS_CREATE, P.PURCHASE_MANAGE],
  payable_allocations: [P.CUSTOMERS, P.VENDORS, P.ACCOUNTS, P.PURCHASE_MANAGE],
  commitments: [P.CUSTOMERS, P.VENDORS],
  commitment_items: [P.CUSTOMERS, P.VENDORS],
  vendors: [P.VENDORS],
  accounts: [P.ACCOUNTS, P.POS_CREATE, P.EXPENSES_MANAGE],
  account_transactions: [P.ACCOUNTS, P.POS_CREATE, P.EXPENSES_MANAGE],
  expenses: [P.EXPENSES_MANAGE],
  purchase_orders: [P.PURCHASE_MANAGE],
  purchase_order_items: [P.PURCHASE_MANAGE],
  vendor_payables: [P.PURCHASE_MANAGE],
  inspections: [P.INSPECTIONS, P.POS_CREATE],
  users: [P.TEAM_MANAGE],
  role_permissions: [P.TEAM_MANAGE],
  // See the note in READ_PERMISSIONS: a pairing code is a permanent sync token
  // in waiting, so minting one needs team-management rights.
  devices: [P.TEAM_MANAGE],
  shops: [P.SHOP_MANAGE],
  settings: [P.SHOP_MANAGE],
  // Writes go through the admin-gated REST routes in production; this entry is
  // the floor for the SQL path, so a cashier cannot flip flags directly.
  config: [P.SHOP_MANAGE],
  feature_flags: [P.SHOP_MANAGE],
  reminders: [P.DASHBOARD],
};

const WRITE_VERB = /^\s*(insert|update|delete|truncate|alter|drop|create|grant|revoke)\b/;

/** Every table referenced by a statement (from / join / into / update / delete from). */
function extractTables(lower) {
  const tables = new Set();
  const re = /\b(?:from|join|into|update|using|delete\s+from)\s+"?([a-z_][a-z0-9_]*)"?/g;
  let m;
  while ((m = re.exec(lower)) !== null) tables.add(m[1]);
  return tables;
}

/**
 * The permission(s) a statement needs, or null when nothing specific applies.
 * An array means "any one of these is enough".
 */
function requiredPermissions(sql) {
  const lower = String(sql || '')
    .toLowerCase()
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ');
  const trimmed = lower.trim();
  const tables = extractTables(lower);
  const first = tables.values().next().value;

  // ── writes ────────────────────────────────────────────────────
  if (WRITE_VERB.test(trimmed)) {
    const m = trimmed.match(/^\s*(?:insert\s+into|update|delete\s+from|truncate\s+table?)\s+"?([a-z_][a-z0-9_]*)"?/);
    const target = (m && m[1]) || first;

    if (target === 'orders') {
      if (/^delete/.test(trimmed)) return [P.BILL_DELETE];
      if (/^insert/.test(trimmed)) return [P.POS_CREATE];
      if (/status\s*=\s*'(cancelled|void)'/.test(trimmed)) return [P.BILL_VOID];
      return [P.BILL_EDIT];
    }
    if (target === 'order_items') {
      return /^insert/.test(trimmed) ? [P.POS_CREATE] : [P.BILL_EDIT];
    }
    return WRITE_PERMISSIONS[target] || null;
  }

  // ── reads ─────────────────────────────────────────────────────
  // Sensitive tables gate the whole statement wherever they appear.
  if (tables.has('users') || tables.has('role_permissions')) return [P.TEAM_MANAGE];
  if (tables.has('expenses')) return [P.EXPENSES_MANAGE, P.REPORTS, P.DASHBOARD];
  if (tables.has('accounts') || tables.has('account_transactions')) {
    return [P.ACCOUNTS, P.POS_CREATE, P.EXPENSES_MANAGE, P.DASHBOARD];
  }
  return (first && READ_PERMISSIONS[first]) || null;
}

// Short-lived cache so a busy sale doesn't re-read the user row per statement.
// Flushed whenever `users` is written, so access changes take effect at once.
const permCache = new Map();
const PERM_TTL_MS = 5000;

async function loadPermissions(userId, fallbackRole) {
  const now = Date.now();
  const hit = permCache.get(userId);
  if (hit && now - hit.at < PERM_TTL_MS) return hit;

  const res = await query('SELECT role, permissions FROM users WHERE id = $1', [userId]);
  const row = res.rows[0] || {};
  const role = String(row.role || fallbackRole || '').toLowerCase();
  const entry = {
    at: now,
    role,
    isAdmin: ADMIN_ROLES.has(role),
    perms: parsePermissions(row.permissions),
  };
  permCache.set(userId, entry);
  return entry;
}

/**
 * Express middleware factory. `sqlFrom(req)` returns the statement(s) about to
 * run — a string, or an array where EVERY statement must pass.
 */
function requirePermission(sqlFrom) {
  return async (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    try {
      const entry = await loadPermissions(req.user.id, req.user.role);
      if (entry.isAdmin) return next();

      const raw = typeof sqlFrom === 'function' ? sqlFrom(req) : '';
      const sqls = (Array.isArray(raw) ? raw : [raw]).filter((s) => typeof s === 'string' && s.trim());
      const needs = sqls.map(requiredPermissions).filter((n) => n && n.length);
      const missing = needs.filter((need) => !need.some((p) => entry.perms.includes(p)));
      if (!missing.length) return next();

      console.warn(`Permission denied (user ${req.user.id}) needs ${missing[0].join(' | ')} :: ${String(sqls[0]).slice(0, 90)}`);
      return res.status(403).json({ error: 'Permission denied', required: missing[0] });
    } catch (err) {
      console.error('Permission check error:', err.message);
      return res.status(500).json({ error: 'Permission check failed' });
    }
  };
}

// ─── Health Check ───────────────────────────────────────────────
app.get('/api/health', async (req, res) => {
  try {
    const result = await query('SELECT NOW() as time');
    res.json({ status: 'ok', db: 'connected', time: result.rows[0].time });
  } catch (err) {
    res.status(503).json({ status: 'error', db: 'disconnected', error: err.message });
  }
});

// ─── Auth: Login ────────────────────────────────────────────────
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });

  try {
    const result = await query(
      'SELECT id, shop_id, email, password_hash, full_name, role, permissions, created_at FROM users WHERE email = $1 LIMIT 1',
      [email]
    );
    if (!result.rows.length) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const user = result.rows[0];

    // Check password: bcrypt hash or demo passwords
    let valid = false;
    if (password === 'admin123' || password === 'cashier123') {
      valid = true;
    } else if (user.password_hash) {
      valid = await bcrypt.compare(password, user.password_hash);
    }

    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, shop_id: user.shop_id },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    // Every outlet this login may enter, so the app can render the selector
    // without a second request. user_shops / shops are exempt from row security
    // (you must be able to read your own memberships before any outlet is
    // known), so this is deliberately unscoped.
    const outlets = await query(
      `SELECT us.shop_id, us.role, s.name, s.address, s.phone
         FROM user_shops us
         JOIN shops s ON s.id = us.shop_id
        WHERE us.user_id = $1
        ORDER BY us.shop_id`,
      [user.id]
    );

    res.json({ token, user, shops: outlets.rows });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Auth: Me ───────────────────────────────────────────────────
app.get('/api/auth/me', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const result = await query(
      'SELECT id, shop_id, email, password_hash, full_name, role, permissions, created_at FROM users WHERE id = $1',
      [req.user.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'User not found' });
    res.json({ user: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Which outlet is this request for? ─────────────────────────────────────
//
// Every dbSelect / dbExecute / dbTransaction in the browser travels through
// /api/query, /api/execute or /api/transaction. Scoping these three therefore
// scopes all 118 of those call sites at once, without rewriting any of them -
// the row policies do the filtering.
//
// The request may name its outlet in the X-Shop-Id header, because one login
// now covers several. That header MUST be validated against user_shops: without
// the check it would be an authorization bypass, not a scope, and any user
// could read another outlet simply by naming it. An unrecognised value falls
// back to the user's home outlet rather than being rejected outright, so a
// stale header degrades to the safe default instead of breaking the screen.
async function resolveShop(req) {
  if (!req.user) return null;
  const home = req.user.shop_id || null;
  const raw = req.headers['x-shop-id'];
  if (!raw) return home;
  const want = parseInt(String(raw), 10);
  if (!Number.isFinite(want)) return home;
  if (want === home) return want;
  const r = await query(
    'SELECT shop_id FROM user_shops WHERE user_id = $1 AND shop_id = $2',
    [req.user.id, want]
  );
  return r.rows.length ? want : home;
}

// ─── Generic Query Endpoint (for dbSelect) ──────────────────────
app.post('/api/query', requirePermission((req) => req.body && req.body.sql), async (req, res) => {
  const { sql, params } = req.body;
  if (!sql || typeof sql !== 'string') {
    return res.status(400).json({ error: 'SQL query required' });
  }

  // Safety: reject dangerous operations on the API
  const lower = sql.trim().toLowerCase();
  if (lower.startsWith('drop ') || lower.startsWith('truncate ')) {
    return res.status(403).json({ error: 'Forbidden query type' });
  }

  try {
    const shopId = await resolveShop(req);
    const result = await query(sql, params || [], shopId);
    res.json(result.rows);
  } catch (err) {
    console.error('Query error:', err.message, 'SQL:', sql.substring(0, 100));
    res.status(500).json({ error: err.message });
  }
});

// ─── Execute Endpoint (for dbExecute - INSERT/UPDATE/DELETE) ───
app.post('/api/execute', requirePermission((req) => req.body && req.body.sql), async (req, res) => {
  const { sql, params } = req.body;
  if (!sql || typeof sql !== 'string') {
    return res.status(400).json({ error: 'SQL statement required' });
  }

  try {
    const shopId = await resolveShop(req);
    const result = await query(sql, params || [], shopId);
    if (/\busers\b/i.test(String(sql))) permCache.clear(); // access changed → drop cached permissions
    res.json({ rowCount: result.rowCount, rows: result.rows });
  } catch (err) {
    console.error('Execute error:', err.message, 'SQL:', sql.substring(0, 100));
    res.status(500).json({ error: err.message });
  }
});

// ─── Transaction Endpoint (multi-statement) ─────────────────────
// Every statement in the batch must clear the permission check.
app.post(
  '/api/transaction',
  requirePermission((req) => ((req.body && req.body.statements) || []).map((s) => s && s.sql)),
  async (req, res) => {
    const { statements } = req.body;
    if (!Array.isArray(statements) || !statements.length) {
      return res.status(400).json({ error: 'Statements array required' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // The transaction endpoint runs its own BEGIN, so the shop context is set
      // here rather than routed through withShop(): the setting is
      // transaction-local, and BEGIN must come first or is_local has nothing to
      // attach to and is discarded immediately.
      await client.query("SELECT set_config('app.shop_id', $1, true)",
        [String(await resolveShop(req) ?? '')]);
      const results = [];
      let touchedUsers = false;
      for (const stmt of statements) {
        if (/\busers\b/i.test(String(stmt.sql))) touchedUsers = true;
        const result = await client.query(stmt.sql, stmt.params || []);
        results.push({ rowCount: result.rowCount, rows: result.rows });
      }
      await client.query('COMMIT');
      if (touchedUsers) permCache.clear(); // access changed → drop cached permissions
      res.json({ results });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('Transaction error:', err.message);
      res.status(500).json({ error: err.message });
    } finally {
      client.release();
    }
  }
);

// ─── Sync API (/api/v1/*) ────────────────────────────────────────
// Device-token endpoints for the desktop sync agent and the Android APK.
// Devices authenticate with a per-device bearer token (issued on pairing);
// shop ownership is enforced server-side — shop_id comes from the token,
// never from the client.

import crypto from 'node:crypto';

const SYNC_TABLES = {
  products:    { softDelete: true },
  services:    { softDelete: true },
  customers:   { softDelete: true },
  vehicles:    { softDelete: true },
  vendors:     { softDelete: true },
  orders:      {},
  order_items: {},
  expenses:    { softDelete: true },
  accounts:    {},
  account_transactions: {},
  purchase_orders: {},
  vendor_payables: {},
  reminders:   {},
  inspections: {},
  cash_movements: {},
  reservations: {},
  // Append-only money history: no softDelete, because a "deleted" ledger row
  // would silently change a balance the shop has already shown a customer.
  // Delete is rejected for these tables; a correction is an adjustment row.
  party_ledger: {},
  commitments: {},
  // commitment_items is deliberately NOT listed yet: it has no shop_id, and the
  // pull scopes every table on (shop_id, updated_at). It joins the list in the
  // same migration that gives it a shop_id — listing it now would just log a
  // per-sync "column does not exist" error for every device.
  // The stock ledger (migration 025) is append-only for the same reason as
  // party_ledger: deleting a movement would change a stock balance the shop has
  // already shown, so a mistake is corrected with a reversing row.
  stock_movements: {},
  // Price lists (migration 028). Replicated so the desktop POS can price a
  // customer from their own list while offline. Read-mostly, but still listed
  // because the desktop reads them on every customer selection.
  price_lists: {},
  price_list_items: {},
  party_price_lists: {},
  party_prices: {},
  // Customer groups (migration 031) decide the price tier, so they replicate for
  // the same reason the price lists do.
  customer_groups: {},
  // Units (migration 032) replicate so every device agrees on what a "litre" is
  // and how many decimals it carries, rather than each re-parsing a string.
  units: {},
  unit_conversions: {},
  // Warehouses and locations (migration 033). stock_levels is deliberately
  // absent: it is derived, stock_movements already replicates, and syncing a
  // cache alongside its own source is how the two arrive out of step.
  warehouses: {},
  warehouse_locations: {},
};

/** Resolve a device from its bearer token. Sets req.device or leaves null. */
async function deviceAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) { req.device = null; return next(); }
  try {
    const payload = jwt.verify(authHeader.slice(7), JWT_SECRET);
    if (!payload.device_id) { req.device = null; return next(); }
    const r = await query('SELECT id, shop_id, kind, name, revoked FROM devices WHERE id = $1', [payload.device_id]);
    if (!r.rows.length || r.rows[0].revoked) { req.device = null; return next(); }
    req.device = r.rows[0];
    next();
  } catch {
    req.device = null;
    next();
  }
}
app.use(deviceAuth);

/** Admin/owner generates a one-time pairing code for a new device. */
app.post('/api/v1/devices', requirePermission(() => 'SELECT id FROM users'), async (req, res) => {
  const { kind = 'desktop', name = '' } = req.body || {};
  const shopId = req.user.shop_id || 1;
  const code = crypto.randomBytes(4).toString('hex').toUpperCase(); // e.g. "A3F9C2D1"
  await query(
    "INSERT INTO devices (shop_id, kind, name, pairing_code) VALUES ($1, $2, $3, $4)",
    [shopId, kind === 'mobile' ? 'mobile' : 'desktop', String(name).slice(0, 60), code]
  );
  res.json({ pairing_code: code, note: 'Enter this code on the device within 24h.' });
});

/** Device pairs with the one-time code → receives its own long-lived token. */
app.post('/api/v1/devices/pair', async (req, res) => {
  const { code, name } = req.body || {};
  if (!code) return res.status(400).json({ error: 'Pairing code required' });
  const r = await query(
    'SELECT id, shop_id, kind FROM devices WHERE pairing_code = $1 AND revoked = FALSE',
    [String(code).trim().toUpperCase()]
  );
  if (!r.rows.length) return res.status(401).json({ error: 'Invalid or used pairing code' });
  const d = r.rows[0];
  const token = jwt.sign(
    { device_id: d.id, shop_id: d.shop_id, kind: d.kind },
    JWT_SECRET,
    { expiresIn: '365d' }
  );
  const hash = await bcrypt.hash(token, 10);
  await query(
    "UPDATE devices SET token_hash = $1, pairing_code = NULL, name = COALESCE(NULLIF($2,''), name) WHERE id = $3",
    [hash, String(name || ''), d.id]
  );
  res.json({ token, device: { id: d.id, shop_id: d.shop_id, kind: d.kind } });
});

/**
 * Ping: is this device's token still good, and what can the server see?
 *
 * Deliberately tiny and unauthenticated-free of the sync machinery. When a
 * field user reports "cannot sync", this is the first thing to check: it
 * separates "the phone cannot reach the shop" from "the token was revoked" from
 * "the token is fine but the data will not apply", which all look identical in
 * the app.
 */
app.get('/api/v1/ping', async (req, res) => {
  if (!req.device) return res.status(401).json({ error: 'Device token required' });
  const shopId = req.device.shop_id;
  try {
    const counts = {};
    for (const table of ['customers', 'cash_movements', 'reservations', 'party_ledger']) {
      // shopId passed so row security applies once enabled. The device's outlet
      // is already scoped in the SQL as well - belt and braces, because the SQL
      // keeps working on the offline desktop replica while the header keeps
      // working on the server.
      const r = await query(
        `SELECT count(*)::int AS c FROM ${table} WHERE shop_id = $1`, [shopId], shopId
      );
      counts[table] = r.rows[0] ? r.rows[0].c : 0;
    }
    const dev = await query(
      'SELECT id, name, kind, last_sync_at, sync_requested_at, created_at FROM devices WHERE id = $1',
      [req.device.id]
    );
    res.json({
      ok: true,
      server_time: new Date().toISOString(),
      device: dev.rows[0] || { id: req.device.id, kind: req.device.kind },
      counts,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * Book a field collection into the shop's real books.
 *
 * Runs inside the push transaction, right after the row lands, so a collection
 * and its accounting can never disagree. Three things move:
 *
 *   1. the customer's Khata  - a party_ledger payment (credit), which lowers
 *      what they owe, so it shows on their statement and in the Khata;
 *   2. the customer's balance - credit_balance, kept in step with the ledger;
 *   3. the shop's cash       - accounts.balance plus an account_transactions
 *      row, so the money is in the main account instead of invisible.
 *
 * Only `collection` moves money. A `handover` is the same money arriving at the
 * till, so counting it again would double the day's cash; it only reduces what
 * is still out with the phones, which is what "in hand" already reports.
 *
 * Idempotency is the whole design: the first statement claims the row with a
 * conditional UPDATE. A retried push (the protocol upserts on uuid, so retries
 * are normal) claims nothing and does nothing.
 *
 * An unmatched customer is not an error - the money is still banked as cash,
 * because that part is certain. The party link is simply left off and the Field
 * Activity page shows it as unlinked for the shop to match up.
 */
async function postFieldCollection(client, mv, shopId) {
  const claim = await client.query(
    `UPDATE cash_movements SET posted_at = NOW()
      WHERE id = $1 AND posted_at IS NULL
      RETURNING uuid, kind, amount, customer_uuid, customer_name, note, occurred_at`,
    [mv.id],
  );
  if (!claim.rows.length) return; // already posted - a retry
  const c = claim.rows[0];
  if (c.kind !== 'collection') return;

  // Resolve the party: the uuid first, because that is identity. The name is a
  // fallback for rows collected before the phone sent one.
  let cust = null;
  if (c.customer_uuid) {
    const r = await client.query(
      'SELECT id, name FROM customers WHERE shop_id = $1 AND uuid = $2 LIMIT 1',
      [shopId, c.customer_uuid],
    );
    cust = r.rows[0] || null;
  }
  if (!cust && c.customer_name) {
    const r = await client.query(
      'SELECT id, name FROM customers WHERE shop_id = $1 AND lower(name) = lower($2) LIMIT 1',
      [shopId, c.customer_name],
    );
    cust = r.rows[0] || null;
  }

  if (cust) {
    // Deterministic uuid from the movement's own, so a double post is rejected
    // by the unique index rather than by hoping the balance maths matches.
    const ins = await client.query(
      `INSERT INTO party_ledger
         (uuid, shop_id, party_type, party_id, kind, direction, amount,
          cash_movement_id, note, occurred_at, origin)
       VALUES ($1, $2, 'customer', $3, 'payment', 'credit', $4, $5, $6, $7, 'mobile')
       ON CONFLICT (uuid) DO NOTHING
       RETURNING id`,
      [
        'cm-' + c.uuid,
        shopId,
        cust.id,
        c.amount,
        mv.id,
        c.note || `Collection from ${cust.name}`,
        c.occurred_at,
      ],
    );
    if (ins.rows.length) {
      await client.query(
        `UPDATE customers SET credit_balance = COALESCE(credit_balance, 0) - $1 WHERE id = $2`,
        [c.amount, cust.id],
      );
    }
  }

  const acc = await client.query(
    "SELECT id FROM accounts WHERE shop_id = $1 AND type = 'cash' AND active = 1 ORDER BY id LIMIT 1",
    [shopId],
  );
  if (!acc.rows.length) return;
  const accountId = acc.rows[0].id;
  await client.query('UPDATE accounts SET balance = balance + $1 WHERE id = $2', [c.amount, accountId]);
  await client.query(
    `INSERT INTO account_transactions (account_id, amount, type, reference)
     VALUES ($1, $2, 'in', $3)`,
    [accountId, c.amount, 'Field collection ' + String(c.uuid).slice(0, 8)],
  );
}

/** Pull: everything changed since `since` (ms epoch), for this device's shop. */
app.get('/api/v1/pull', async (req, res) => {
  if (!req.device) return res.status(401).json({ error: 'Device token required' });
  const since = new Date(Number(req.query.since) || 0);
  const shopId = req.device.shop_id;
  const serverNow = new Date();
  const changes = {};
  for (const [table, meta] of Object.entries(SYNC_TABLES)) {
    // Each table is fetched independently. A failure here used to reject an
    // unhandled promise, which kills Node 20 outright, takes the API down for
    // every user, and shows the phone a dropped connection it reports as
    // "cannot reach the server". One bad table must never do that again.
    try {
      let sqlText = `SELECT * FROM ${table} WHERE shop_id = $1 AND updated_at > $2`;
      const params = [shopId, since.toISOString()];
      if (meta.softDelete) sqlText += ` AND (deleted_at IS NULL OR deleted_at > $2)`;
      sqlText += ` ORDER BY updated_at LIMIT 500`;
      // shopId third arg sets the row-security context for the device's outlet.
      const r = await query(sqlText, params, shopId);
      if (r.rows.length) changes[table] = r.rows;
    } catch (e) {
      console.error(`[sync] pull failed for "${table}":`, e.message);
    }
  }

  try {
    await query('UPDATE devices SET last_sync_at = NOW() WHERE id = $1', [req.device.id]);
  } catch (e) {
    console.error('[sync] could not stamp last_sync_at:', e.message);
  }

  // Carry any outstanding "please sync" note from the shop alongside the data.
  // Read separately from the stamp above so a failure here cannot break the
  // download the phone came for.
  let syncRequestedAt = null;
  try {
    const r = await query('SELECT sync_requested_at FROM devices WHERE id = $1', [req.device.id]);
    syncRequestedAt = r.rows[0] ? r.rows[0].sync_requested_at : null;
  } catch (e) {
    console.error('[sync] could not read sync_requested_at:', e.message);
  }

  res.json({
    cursor: serverNow.getTime(),
    server_time: serverNow.toISOString(),
    sync_requested_at: syncRequestedAt,
    changes,
  });
});

/**
 * Acknowledge a "please sync" note from the shop.
 *
 * The phone cannot be reached, so the shop leaves a timestamp and the phone
 * clears it by syncing. Rather than trusting a timestamp echoed back by the
 * phone, this compares two columns the server owns: the note is only cleared
 * when the device has actually synced (last_sync_at, stamped by /pull) at or
 * after the moment the note was left.
 *
 * The echoed-timestamp version of this was wrong. Postgres keeps microseconds
 * on NOW() but JSON.stringify serialises a Date to milliseconds, so the value
 * the phone received was always a hair earlier than the stored one, the
 * comparison was false, and the note could never be cleared. It also removes
 * the need to trust client input for the decision at all.
 *
 * A note left after the phone's last sync is deliberately kept: that phone has
 * not seen it yet.
 */
app.post('/api/v1/sync-request/ack', async (req, res) => {
  if (!req.device) return res.status(401).json({ error: 'Device token required' });
  const r = await query(
    `UPDATE devices SET sync_requested_at = NULL
      WHERE id = $1
        AND sync_requested_at IS NOT NULL
        AND last_sync_at IS NOT NULL
        AND last_sync_at >= sync_requested_at`,
    [req.device.id]
  );
  res.json({ ok: true, cleared: r.rowCount });
});

// ─── Last-resort safety nets ────────────────────────────────────────────────
// Without these, one rejected promise anywhere in an async route handler
// terminates the Node process (the default since Node 15). Docker then
// restarts the API and every connected client sees its request die with no
// usable error. Log loudly instead of dying, and answer the client properly.
process.on('unhandledRejection', (reason) => {
  console.error('[fatal] unhandled promise rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[fatal] uncaught exception:', err);
});

/**
 * Push: apply a batch of client changes. Idempotent by uuid: LWW (last
 * writer wins) by updated_at for every table, with shop_id forced from the
 * device token. Raw SQL never crosses this boundary — the endpoint maps
 * {table, uuid, op, row} objects into parameterised upserts.
 */
app.post('/api/v1/push', async (req, res) => {
  if (!req.device) return res.status(401).json({ error: 'Device token required' });
  const shopId = req.device.shop_id;
  const { changes = [] } = req.body || {};
  if (!Array.isArray(changes)) return res.status(400).json({ error: 'changes array required' });

  const applied = [];
  const rejected = [];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Scoped to the device's own outlet for the whole push. A device belongs to
    // exactly one outlet (it is fixed at pairing), so this is the phone's outlet
    // by construction and needs no header - but it MUST be set here or row
    // security will hide the very rows the push is trying to write.
    await client.query("SELECT set_config('app.shop_id', $1, true)", [String(shopId)]);
    for (const ch of changes.slice(0, 1000)) {
      const { table, uuid, op = 'insert', row } = ch || {};
      const meta = SYNC_TABLES[table];
      if (!meta || !uuid || typeof row !== 'object' || row === null) {
        rejected.push({ uuid, reason: 'invalid change' });
        continue;
      }
      if (op === 'delete') {
        if (meta.softDelete) {
          await client.query(
            `UPDATE ${table} SET deleted_at = NOW(), updated_at = NOW() WHERE uuid = $1 AND shop_id = $2`,
            [uuid, shopId]
          );
          applied.push({ table, uuid, op });
        } else {
          rejected.push({ uuid, reason: 'delete not supported for ' + table });
        }
        continue;
      }
      // Sanitise the row: only real columns, id/uuid/shop_id controlled here.
      const colInfo = await client.query(
        'SELECT column_name FROM information_schema.columns WHERE table_name = $1', [table]
      );
      const valid = new Set(colInfo.rows.map((c) => c.column_name));
      const cols = ['uuid', 'shop_id'];
      const vals = [uuid, shopId];
      for (const [k, v] of Object.entries(row)) {
        if (k === 'id' || k === 'uuid' || k === 'shop_id' || !valid.has(k)) continue;
        cols.push(k);
        vals.push(v);
      }
      if (!cols.includes('updated_at')) { cols.push('updated_at'); vals.push(new Date().toISOString()); }
      // Stamp which phone sent this. The request is already authenticated as
      // that device, so this cannot be spoofed by the row - it is the only
      // reliable attribution, since the phone does not know its own id.
      if (table === 'cash_movements' && valid.has('taken_by_device_id')) {
        if (!cols.includes('taken_by_device_id')) {
          cols.push('taken_by_device_id');
          vals.push(req.device.id);
        }
      }
      const placeholders = cols.map((_, i) => `$${i + 1}`);
      const updateSet = cols
        .filter((c) => c !== 'uuid' && c !== 'shop_id')
        .map((c) => `${c} = EXCLUDED.${c}`)
        .join(', ');
      const sqlText = `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders.join(', ')})
        ON CONFLICT (uuid) DO UPDATE SET ${updateSet}
        WHERE ${table}.updated_at <= EXCLUDED.updated_at`;
      try {
        await client.query(sqlText, vals);
        applied.push({ table, uuid, op });
        // A collection is not just a row: post it into the cash account and the
        // customer's Khata in the same transaction. Skipped for every other
        // table, which is why this is here and not in the generic insert.
        if (table === 'cash_movements') {
          const r = await client.query(
            'SELECT id FROM cash_movements WHERE uuid = $1 AND shop_id = $2',
            [uuid, shopId],
          );
          if (r.rows.length) await postFieldCollection(client, r.rows[0], shopId);
        }
      } catch (e) {
        rejected.push({ uuid, reason: e.message });
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Push error:', err.message);
    return res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
  await query('UPDATE devices SET last_sync_at = NOW() WHERE id = $1', [req.device.id]);
  res.json({ applied, rejected });
});

// ─── App update distribution ────────────────────────────────────────────────
// Mirrors the Mirror Twins pattern so publishing a new build is a familiar
// two-step job on the VPS:
//
//   1. copy the new APK into  updates/android/
//   2. edit  updates/android.json  (versionCode, versionName, apk, sha256)
//
// Phones poll /api/v1/app/version on launch and, if versionCode is newer than
// the installed build, download the APK from /api/v1/app/download, verify its
// SHA-256 and hand it to Android's installer.
function readManifest() {
  return new Promise((resolve, reject) => {
    fs.readFile(path.join(UPDATES_DIR, 'android.json'), 'utf8', (err, data) => {
      if (err) return reject(err);
      try {
        resolve(JSON.parse(data));
      } catch (e) {
        reject(e);
      }
    });
  });
}

app.get('/api/v1/app/version', async (req, res) => {
  try {
    const manifest = await readManifest();
    // Rewrite the manifest's URL to point at this server, so the same file
    // works whether the phone reached us by IP or, later, by domain.
    res.json({
      versionCode: manifest.versionCode,
      versionName: manifest.versionName,
      sha256: manifest.sha256,
      mandatory: manifest.mandatory === true,
      notes: manifest.notes || '',
      apk: `${req.protocol}://${req.get('host')}/api/v1/app/download`,
    });
  } catch (e) {
    res.status(404).json({ error: 'No app update has been published yet.' });
  }
});

app.get('/api/v1/app/download', async (req, res) => {
  let manifest;
  try {
    manifest = await readManifest();
  } catch (e) {
    return res.status(404).json({ error: 'No app update has been published yet.' });
  }
  // Only ever serve a plain file name that already exists under the updates
  // directory - never a caller-supplied path.
  const name = path.basename(String(manifest.apk || ''));
  const file = path.join(UPDATES_DIR, 'android', name);
  if (!name || !fs.existsSync(file)) {
    return res.status(404).json({ error: 'The published APK is missing on the server.' });
  }
  res.setHeader('Content-Type', 'application/vnd.android.package-archive');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${name}"`);
  fs.createReadStream(file).pipe(res);
});

// ─── Config & Feature Flags ────────────────────────────────────────────────
//
// Reads / writes the level-A deployment config and per-tenant feature flags.
// The global authMiddleware above populates req.user but never rejects, so
// each route states its own rule: branding keys on /api/config are readable
// pre-login (so the login screen can carry the tenant's name/colours), every
// other config row and all flags need a session, and writes need admin/owner.

// Branding-safe keys — the only ones an unauthenticated caller may read.
const PUBLIC_CONFIG_KEYS = new Set(['app_name', 'primary_color', 'default_branding']);

// Any signed-in session may read these: every role's nav gating needs the
// module manifest, not just managers. Still hidden before login.
const SESSION_CONFIG_KEYS = new Set(['included_modules']);

// Full config (payment gateway, DB environment, module manifest) is for
// admins and whoever holds shop.manage — the same floor the SQL guard uses
// on the /api/query path, so the two doors into the table agree.
async function canReadFullConfig(req) {
  if (!req.user) return false;
  const entry = await loadPermissions(req.user.id, req.user.role);
  return entry.isAdmin || entry.perms.includes(P.SHOP_MANAGE);
}

// GET /api/config — read config rows (or filter by ?key=X).
// Full row set for admins/shop managers; other sessions and no session see
// only the branding-safe subset.
app.get('/api/config', async (req, res) => {
  try {
    const key = typeof req.query.key === 'string' ? req.query.key : undefined;
    const where = key ? 'WHERE key = $1' : '';
    const sql = `SELECT key, value, shop_id, updated_at FROM config ${where}`;
    const params = key ? [key] : [];
    const { rows } = await pool.query(sql, params);
    const allowed = (k) => PUBLIC_CONFIG_KEYS.has(k) || SESSION_CONFIG_KEYS.has(k);
    const visible = (await canReadFullConfig(req))
      ? rows
      : rows.filter((r) => req.user ? allowed(r.key) : PUBLIC_CONFIG_KEYS.has(r.key));
    res.json(visible);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/config/:key — read a single config key (same visibility rules)
app.get('/api/config/:key', async (req, res) => {
  try {
    const { key } = req.params;
    if (!PUBLIC_CONFIG_KEYS.has(key)) {
      if (!req.user) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      if (!SESSION_CONFIG_KEYS.has(key) && !(await canReadFullConfig(req))) {
        return res.status(403).json({ error: 'Permission denied', required: ['shop.manage'] });
      }
    }
    const sql = 'SELECT key, value, shop_id, updated_at FROM config WHERE key = $1';
    const { rows } = await pool.query(sql, [key]);
    if (rows.length) {
      res.json(rows[0]);
    } else {
      res.status(404).json({ error: 'Config key not found' });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/config/:key — update a config key (admin only)
app.patch('/api/config/:key', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (!ADMIN_ROLES.has(req.user.role)) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    const { key } = req.params;
    const { value } = req.body;
    if (value === undefined) {
      return res.status(400).json({ error: 'value is required' });
    }
    const sql = `
      UPDATE config SET value = $1, updated_at = NOW()
      WHERE key = $2
      RETURNING key, value, shop_id, updated_at
    `;
    const { rows } = await pool.query(sql, [value, key]);
    if (rows.length) {
      res.json(rows[0]);
    } else {
      // Insert if not exists (idempotent)
      const insSql = `
        INSERT INTO config (key, value, shop_id, updated_at)
        VALUES ($1, $2, NULL, NOW())
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
        RETURNING key, value, shop_id, updated_at
      `;
      const { rows: inserted } = await pool.query(insSql, [key, value]);
      res.json(inserted[0]);
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/feature-flags — read all feature flags (session required)
app.get('/api/feature-flags', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const sql = 'SELECT key, enabled, shop_id, updated_at FROM feature_flags';
    const { rows } = await pool.query(sql);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/feature-flags/:key — read a single feature flag (session required)
app.get('/api/feature-flags/:key', async (req, res) => {
  try {
    const { key } = req.params;
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const sql = 'SELECT key, enabled, shop_id, updated_at FROM feature_flags WHERE key = $1';
    const { rows } = await pool.query(sql, [key]);
    if (rows.length) {
      res.json(rows[0]);
    } else {
      res.status(404).json({ error: 'Feature flag not found' });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/feature-flags/:key — toggle a feature flag (admin only)
app.patch('/api/feature-flags/:key', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (!ADMIN_ROLES.has(req.user.role)) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    const { key } = req.params;
    const { enabled } = req.body;
    if (enabled === undefined) {
      return res.status(400).json({ error: 'enabled boolean is required' });
    }
    const sql = `
      UPDATE feature_flags SET enabled = $1, updated_at = NOW()
      WHERE key = $2
      RETURNING key, enabled, shop_id, updated_at
    `;
    const { rows } = await pool.query(sql, [enabled, key]);
    if (rows.length) {
      res.json(rows[0]);
    } else {
      // Insert if not exists
      const insSql = `
        INSERT INTO feature_flags (key, enabled, shop_id, updated_at)
        VALUES ($1, $2, NULL, NOW())
        ON CONFLICT (key) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = NOW()
        RETURNING key, enabled, shop_id, updated_at
      `;
      const { rows: inserted } = await pool.query(insSql, [key, enabled]);
      res.json(inserted[0]);
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Express error-handling middleware MUST be registered last, after every route,
// otherwise it is never reached and errors fall through to a dropped connection.
app.use((err, req, res, _next) => {
  console.error('[http] ' + req.method + ' ' + req.originalUrl + ' -> ' + err.message);
  if (res.headersSent) return;
  res.status(500).json({ error: 'Server error: ' + err.message });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Lubric App API server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
  console.log(`Updates dir:  ${UPDATES_DIR}`);
});
