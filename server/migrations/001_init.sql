-- Lubric POS Database Schema v1.0.0 (PostgreSQL)
-- Converted from SQLite schema

-- Shops
CREATE TABLE IF NOT EXISTS shops (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL DEFAULT 'Zafar Lubricants',
  address TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  currency TEXT DEFAULT 'PKR',
  language TEXT DEFAULT 'en',
  used_oil_drum_capacity DOUBLE PRECISION DEFAULT 200,
  manual_price_allowed INTEGER DEFAULT 0,
  wholesale_mode TEXT DEFAULT 'qty',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Users & Roles
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  shop_id INTEGER DEFAULT 1,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'cashier' CHECK(role IN ('admin', 'cashier', 'owner', 'manager')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role TEXT NOT NULL,
  permission_key TEXT NOT NULL,
  PRIMARY KEY(role, permission_key)
);

-- Categories & Brands
CREATE TABLE IF NOT EXISTS categories (
  id SERIAL PRIMARY KEY,
  shop_id INTEGER DEFAULT 1,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS brands (
  id SERIAL PRIMARY KEY,
  shop_id INTEGER DEFAULT 1,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Products with multi-tier pricing
CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  shop_id INTEGER DEFAULT 1,
  sku TEXT,
  barcode TEXT,
  name TEXT NOT NULL,
  brand_id INTEGER REFERENCES brands(id),
  category_id INTEGER REFERENCES categories(id),
  packing TEXT DEFAULT '',
  unit TEXT DEFAULT 'piece',
  variant TEXT,
  mfd_date TEXT,
  exp_date TEXT,
  offer TEXT,
  cost_price DOUBLE PRECISION DEFAULT 0,
  stock_qty DOUBLE PRECISION DEFAULT 0,
  low_stock_threshold DOUBLE PRECISION DEFAULT 5,
  price_returning DOUBLE PRECISION DEFAULT 0,
  price_walking DOUBLE PRECISION,
  price_wholesale DOUBLE PRECISION DEFAULT 0,
  wholesale_min_qty DOUBLE PRECISION DEFAULT 10,
  active INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Services
CREATE TABLE IF NOT EXISTS services (
  id SERIAL PRIMARY KEY,
  shop_id INTEGER DEFAULT 1,
  name TEXT NOT NULL,
  price DOUBLE PRECISION DEFAULT 0,
  active INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Containers
CREATE TABLE IF NOT EXISTS containers (
  id SERIAL PRIMARY KEY,
  shop_id INTEGER DEFAULT 1,
  product_id INTEGER REFERENCES products(id),
  barcode TEXT,
  original_volume DOUBLE PRECISION,
  remaining_volume DOUBLE PRECISION,
  status TEXT DEFAULT 'full' CHECK(status IN ('full', 'opened', 'empty')),
  opened_at TEXT,
  source_order_id INTEGER
);

CREATE TABLE IF NOT EXISTS container_splits (
  id SERIAL PRIMARY KEY,
  container_id INTEGER REFERENCES containers(id),
  sold_qty DOUBLE PRECISION,
  sold_at TEXT,
  order_id INTEGER
);

-- Customers
CREATE TABLE IF NOT EXISTS customers (
  id SERIAL PRIMARY KEY,
  shop_id INTEGER DEFAULT 1,
  name TEXT NOT NULL,
  phone TEXT DEFAULT '',
  customer_type TEXT DEFAULT 'walking' CHECK(customer_type IN ('returning', 'walking', 'wholesale')),
  credit_balance DOUBLE PRECISION DEFAULT 0,
  last_visit_at TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Vehicles
CREATE TABLE IF NOT EXISTS vehicles (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER REFERENCES customers(id),
  registration TEXT DEFAULT '',
  make TEXT DEFAULT '',
  model TEXT DEFAULT '',
  mileage INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Vendors
CREATE TABLE IF NOT EXISTS vendors (
  id SERIAL PRIMARY KEY,
  shop_id INTEGER DEFAULT 1,
  name TEXT NOT NULL,
  contact TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  payable_balance DOUBLE PRECISION DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vendor_payables (
  id SERIAL PRIMARY KEY,
  vendor_id INTEGER REFERENCES vendors(id),
  amount DOUBLE PRECISION,
  due_date TEXT,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'paid', 'partial')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Accounts
CREATE TABLE IF NOT EXISTS accounts (
  id SERIAL PRIMARY KEY,
  shop_id INTEGER DEFAULT 1,
  name TEXT NOT NULL,
  type TEXT CHECK(type IN ('cash', 'bank', 'wallet')),
  balance DOUBLE PRECISION DEFAULT 0,
  active INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS account_transactions (
  id SERIAL PRIMARY KEY,
  account_id INTEGER REFERENCES accounts(id),
  amount DOUBLE PRECISION,
  type TEXT CHECK(type IN ('in', 'out', 'transfer_in', 'transfer_out')),
  reference TEXT DEFAULT '',
  related_account_id INTEGER REFERENCES accounts(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Orders
CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  shop_id INTEGER DEFAULT 1,
  customer_id INTEGER REFERENCES customers(id),
  user_id INTEGER REFERENCES users(id),
  total DOUBLE PRECISION DEFAULT 0,
  payment_account_id INTEGER REFERENCES accounts(id),
  payment_method TEXT DEFAULT 'cash',
  status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'completed', 'cancelled', 'returned')),
  vehicle_id INTEGER REFERENCES vehicles(id),
  mileage INTEGER DEFAULT 0,
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS order_items (
  id SERIAL PRIMARY KEY,
  order_id INTEGER REFERENCES orders(id),
  kind TEXT CHECK(kind IN ('product', 'service', 'partial_container', 'used_oil')),
  ref_id INTEGER,
  product_name TEXT DEFAULT '',
  qty DOUBLE PRECISION DEFAULT 0,
  unit_price DOUBLE PRECISION DEFAULT 0,
  line_total DOUBLE PRECISION DEFAULT 0,
  container_id INTEGER REFERENCES containers(id)
);

-- Used Oil
CREATE TABLE IF NOT EXISTS used_oil_drum (
  id SERIAL PRIMARY KEY,
  shop_id INTEGER DEFAULT 1,
  current_litres DOUBLE PRECISION DEFAULT 0,
  capacity DOUBLE PRECISION DEFAULT 200
);

CREATE TABLE IF NOT EXISTS used_oil_log (
  id SERIAL PRIMARY KEY,
  drum_id INTEGER REFERENCES used_oil_drum(id),
  litres DOUBLE PRECISION,
  type TEXT CHECK(type IN ('added', 'removed')),
  source_order_id INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Expenses
CREATE TABLE IF NOT EXISTS expenses (
  id SERIAL PRIMARY KEY,
  shop_id INTEGER DEFAULT 1,
  category TEXT DEFAULT '',
  amount DOUBLE PRECISION DEFAULT 0,
  account_id INTEGER REFERENCES accounts(id),
  date TEXT,
  note TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Settings
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT DEFAULT ''
);

-- Inspections
CREATE TABLE IF NOT EXISTS inspections (
  id SERIAL PRIMARY KEY,
  shop_id INTEGER DEFAULT 1,
  order_id INTEGER REFERENCES orders(id),
  customer_id INTEGER REFERENCES customers(id),
  vehicle_id INTEGER REFERENCES vehicles(id),
  inspection_data JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Purchase Orders
CREATE TABLE IF NOT EXISTS purchase_orders (
  id SERIAL PRIMARY KEY,
  shop_id INTEGER DEFAULT 1,
  vendor_id INTEGER REFERENCES vendors(id),
  total DOUBLE PRECISION DEFAULT 0,
  status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'received', 'cancelled')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id SERIAL PRIMARY KEY,
  purchase_order_id INTEGER REFERENCES purchase_orders(id),
  product_id INTEGER REFERENCES products(id),
  qty DOUBLE PRECISION DEFAULT 0,
  cost_price DOUBLE PRECISION DEFAULT 0,
  line_total DOUBLE PRECISION DEFAULT 0
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_products_shop ON products(shop_id);
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
CREATE INDEX IF NOT EXISTS idx_orders_shop ON orders(shop_id);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_customers_shop ON customers(shop_id);
CREATE INDEX IF NOT EXISTS idx_containers_status ON containers(status);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);

