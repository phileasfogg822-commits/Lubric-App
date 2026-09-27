-- Lubric POS Database Schema v0.1.0
-- Run on SQLite via Tauri SQL plugin

-- Shops
CREATE TABLE IF NOT EXISTS shops (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL DEFAULT 'Zafar Lubricants',
  address TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  currency TEXT DEFAULT 'PKR',
  language TEXT DEFAULT 'en',
  used_oil_drum_capacity REAL DEFAULT 200,
  manual_price_allowed INTEGER DEFAULT 0,
  wholesale_mode TEXT DEFAULT 'qty',
  created_at TEXT DEFAULT (datetime('now'))
);

-- Users & Roles
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id INTEGER DEFAULT 1,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'cashier' CHECK(role IN ('admin', 'cashier')),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role TEXT NOT NULL,
  permission_key TEXT NOT NULL,
  PRIMARY KEY(role, permission_key)
);

-- Categories & Brands
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id INTEGER DEFAULT 1,
  name TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS brands (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id INTEGER DEFAULT 1,
  name TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Products with multi-tier pricing
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id INTEGER DEFAULT 1,
  sku TEXT,
  barcode TEXT,
  name TEXT NOT NULL,
  brand_id INTEGER,
  category_id INTEGER,
  packing TEXT DEFAULT '',
  unit TEXT DEFAULT 'piece',
  cost_price REAL DEFAULT 0,
  stock_qty REAL DEFAULT 0,
  low_stock_threshold REAL DEFAULT 5,
  price_returning REAL DEFAULT 0,
  price_walking REAL,
  price_wholesale REAL DEFAULT 0,
  wholesale_min_qty REAL DEFAULT 10,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (brand_id) REFERENCES brands(id),
  FOREIGN KEY (category_id) REFERENCES categories(id)
);

-- Services
CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id INTEGER DEFAULT 1,
  name TEXT NOT NULL,
  price REAL DEFAULT 0,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);
