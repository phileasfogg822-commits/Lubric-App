-- Vendors & Payables
CREATE TABLE IF NOT EXISTS vendors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id INTEGER DEFAULT 1,
  name TEXT NOT NULL,
  contact TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  payable_balance REAL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS vendor_payables (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_id INTEGER NOT NULL,
  amount REAL DEFAULT 0,
  due_date TEXT,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'paid', 'partial')),
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (vendor_id) REFERENCES vendors(id)
);

-- Accounts & Transactions
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id INTEGER DEFAULT 1,
  name TEXT NOT NULL,
  type TEXT DEFAULT 'cash' CHECK(type IN ('cash', 'bank', 'wallet')),
  balance REAL DEFAULT 0,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS account_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  amount REAL NOT NULL,
  type TEXT DEFAULT 'in' CHECK(type IN ('in', 'out', 'transfer_in', 'transfer_out')),
  reference TEXT DEFAULT '',
  related_account_id INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (account_id) REFERENCES accounts(id),
  FOREIGN KEY (related_account_id) REFERENCES accounts(id)
);

-- Orders
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id INTEGER DEFAULT 1,
  customer_id INTEGER,
  user_id INTEGER NOT NULL,
  total REAL DEFAULT 0,
  payment_account_id INTEGER,
  payment_method TEXT DEFAULT 'cash',
  status TEXT DEFAULT 'completed' CHECK(status IN ('draft', 'completed', 'cancelled', 'returned')),
  vehicle_id INTEGER,
  mileage INTEGER DEFAULT 0,
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (payment_account_id) REFERENCES accounts(id)
);

-- Order Items
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('product', 'service', 'partial_container', 'used_oil')),
  ref_id INTEGER NOT NULL,
  product_name TEXT DEFAULT '',
  qty REAL DEFAULT 1,
  unit_price REAL DEFAULT 0,
  line_total REAL DEFAULT 0,
  container_id INTEGER,
  FOREIGN KEY (order_id) REFERENCES orders(id),
  FOREIGN KEY (container_id) REFERENCES containers(id)
);

-- Used Oil Drum
CREATE TABLE IF NOT EXISTS used_oil_drum (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id INTEGER DEFAULT 1,
  current_litres REAL DEFAULT 0,
  capacity REAL DEFAULT 200
);

CREATE TABLE IF NOT EXISTS used_oil_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  drum_id INTEGER NOT NULL,
  litres REAL NOT NULL,
  type TEXT DEFAULT 'added' CHECK(type IN ('added', 'removed')),
  source_order_id INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (drum_id) REFERENCES used_oil_drum(id)
);

-- Expenses
CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id INTEGER DEFAULT 1,
  category TEXT NOT NULL,
  amount REAL DEFAULT 0,
  account_id INTEGER,
  date TEXT NOT NULL,
  note TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (account_id) REFERENCES accounts(id)
);

-- Settings (key-value)
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_brand ON products(brand_id);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_containers_product ON containers(product_id);
CREATE INDEX IF NOT EXISTS idx_vehicles_customer ON vehicles(customer_id);
CREATE INDEX IF NOT EXISTS idx_transactions_account ON account_transactions(account_id);
