-- Containers (bottles/jugs - half-bottle tracker)
CREATE TABLE IF NOT EXISTS containers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id INTEGER DEFAULT 1,
  product_id INTEGER NOT NULL,
  barcode TEXT,
  original_volume REAL NOT NULL,
  remaining_volume REAL NOT NULL,
  status TEXT DEFAULT 'opened' CHECK(status IN ('full', 'opened', 'empty')),
  opened_at TEXT DEFAULT (datetime('now')),
  source_order_id INTEGER,
  FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE TABLE IF NOT EXISTS container_splits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  container_id INTEGER NOT NULL,
  sold_qty REAL NOT NULL,
  sold_at TEXT DEFAULT (datetime('now')),
  order_id INTEGER,
  FOREIGN KEY (container_id) REFERENCES containers(id)
);

-- Customers & Vehicles
CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id INTEGER DEFAULT 1,
  name TEXT NOT NULL,
  phone TEXT DEFAULT '',
  customer_type TEXT DEFAULT 'returning' CHECK(customer_type IN ('returning', 'walking', 'wholesale')),
  credit_balance REAL DEFAULT 0,
  last_visit_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS vehicles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  registration TEXT NOT NULL,
  make TEXT DEFAULT '',
  model TEXT DEFAULT '',
  mileage INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);
