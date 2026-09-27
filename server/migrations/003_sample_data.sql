-- Demo / sample data for Lubric POS
-- Safe to delete this file if you want a clean database (run: docker compose down -v).
-- Fully idempotent: explicit ids + ON CONFLICT DO NOTHING so re-running is harmless.

-- ─── Shop identity (printed on receipts / invoices) ──────────────────────────
UPDATE shops SET
  address = COALESCE(NULLIF(address, ''), 'Main Bazaar Road, Lahore'),
  phone   = COALESCE(NULLIF(phone,   ''), '0300-1234567')
WHERE id = 1;
-- ─── Products (3 price tiers each) ────────────────────────────────────────────
INSERT INTO products (id, sku, barcode, name, brand_id, category_id, packing, unit, cost_price, stock_qty, low_stock_threshold, price_returning, price_walking, price_wholesale, wholesale_min_qty) VALUES
  (1,  'OIL-0001', '8901001', 'Shell Helix HX7 10W-40',       1, 1, '4L',    'piece', 4200,  40, 5, 4800,  5000,  4500,  10),
  (2,  'OIL-0002', '8901002', 'Shell Helix HX8 5W-30',        1, 1, '4L',    'piece', 5200,  25, 5, 5900,  6200,  5500,  10),
  (3,  'OIL-0003', '8902001', 'Mobil Super 1000 20W-50',      2, 1, '4L',    'piece', 3900,  30, 5, 4500,  4700,  4200,  10),
  (4,  'OIL-0004', '8902002', 'Mobil Delvac MX 15W-40',       2, 1, '5L',    'piece', 5600,  18, 4, 6400,  6700,  6000,   8),
  (5,  'OIL-0005', '8903001', 'Castrol GTX 20W-50',           3, 1, '4L',    'piece', 4100,  22, 5, 4700,  4900,  4400,  10),
  (6,  'GR-0001',  '8903002', 'Castrol Axle EPX 80W-90',      3, 2, '1L',    'piece', 1500,  35, 6, 1800,  1950,  1650,  12),
  (7,  'HYD-0001', '8904001', 'Valvoline Hydraulic Oil 68',   4, 3, '20L',   'drum',  11500,  8, 2, 13500, 14000, 12800,   4),
  (8,  'ATF-0001', '8904002', 'Valvoline ATF Dexron III',     4, 4, '1L',    'piece', 1600,  20, 5, 1950,  2100,  1800,  12),
  (9,  'CLT-0001', '8905001', 'Total Coolant -37C',           5, 5, '4L',    'piece', 1900,  15, 4, 2300,  2450,  2100,  10),
  (10, 'GRS-0001', '8906001', 'Lubriguard MP3 Grease',        6, 6, '1kg',   'piece',  950,  40, 8, 1200,  1300,  1100,  12),
  (11, 'ADD-0001', '8907001', 'STP Engine Flush',             7, 7, '500ml', 'piece',  700,  24, 6,  950,  1050,   850,  12),
  (12, 'FLT-0001', '8908001', 'Universal Oil Filter (Small)', 7, 8, '1pc',   'piece',  350,  50, 10,  600,  NULL,   500,  20)
ON CONFLICT (id) DO NOTHING;

-- ─── Services ─────────────────────────────────────────────────────────────────
INSERT INTO services (id, name, price) VALUES
  (1, 'Oil Change Service',        300),
  (2, 'Engine Tune-up',           1500),
  (3, 'Chain / Belt Adjustment',   400),
  (4, 'Brake Fluid Top-up',        250),
  (5, 'Grease & Lube (Chassis)',   600)
ON CONFLICT (id) DO NOTHING;

-- ─── Partial containers (opened drums with remaining volume) ───────────────────
INSERT INTO containers (id, product_id, barcode, original_volume, remaining_volume, status, opened_at) VALUES
  (1, 7, 'CT-0001', 20, 12.5, 'opened', '2026-01-15'),
  (2, 7, 'CT-0002', 20, 18.0, 'opened', '2026-02-01'),
  (3, 3, 'CT-0003',  4,  2.5, 'opened', '2026-02-10'),
  (4, 1, 'CT-0004',  4, 3.75, 'opened', '2026-02-12')
ON CONFLICT (id) DO NOTHING;

-- ── Customers (one per pricing tier, so the history panel can be tested) ─────
INSERT INTO customers (id, name, phone, customer_type, credit_balance, last_visit_at) VALUES
  (1, 'Zafar Iqbal',   '0300-1234567', 'returning',     0, '2026-02-14'),
  (2, 'Hassan Traders', '0321-7654321', 'wholesale', 12500, '2026-02-12'),
  (3, 'Ali Raza',      '0333-1112222', 'walking',       0, NULL),
  (4, 'Metro Workshop', '0345-9998888', 'wholesale',    0, '2026-02-11')
ON CONFLICT (id) DO NOTHING;

-- ── Past orders (so "customer history" has something to show) ────────────────
INSERT INTO orders (id, shop_id, customer_id, user_id, total, payment_account_id, payment_method, status, mileage, notes, created_at) VALUES
  (1, 1, 1, 1,  5700, 1, 'cash',   'completed', 48000, 'Regular service', '2026-02-10 10:15'),
  (2, 1, 2, 1, 43800, 2, 'credit', 'completed',     0, 'Bulk order',      '2026-02-12 16:40'),
  (3, 1, 1, 2,  5600, 1, 'cash',   'completed', 51200, '',                '2026-02-14 09:05')
ON CONFLICT (id) DO NOTHING;

INSERT INTO order_items (id, order_id, kind, ref_id, product_name, qty, unit_price, line_total, container_id) VALUES
  (1,  1, 'product',  1, 'Shell Helix HX7 10W-40',        1,  4800,  4800, NULL),
  (2,  1, 'product', 12, 'Universal Oil Filter (Small)',  1,   600,   600, NULL),
  (3,  1, 'service',  1, 'Oil Change Service',            1,   300,   300, NULL),
  (4,  2, 'product',  7, 'Valvoline Hydraulic Oil 68',    1, 12800, 12800, NULL),
  (5,  2, 'product',  4, 'Mobil Delvac MX 15W-40',        2,  6000, 12000, NULL),
  (6,  2, 'product', 10, 'Lubriguard MP3 Grease',         8,  1100,  8800, NULL),
  (7,  2, 'product', 11, 'STP Engine Flush',             12,   850, 10200, NULL),
  (8,  3, 'product',  5, 'Castrol GTX 20W-50',            1,  4700,  4700, NULL),
  (9,  3, 'product', 12, 'Universal Oil Filter (Small)',  1,   600,   600, NULL),
  (10, 3, 'service',  1, 'Oil Change Service',            1,   300,   300, NULL)
ON CONFLICT (id) DO NOTHING;

-- ── Advance SERIAL sequences past the explicit ids ───────────────────────────
-- Without this, the next INSERT from the app would try id=1 and collide.
SELECT setval(pg_get_serial_sequence('products',    'id'), COALESCE((SELECT MAX(id) FROM products),    1));
SELECT setval(pg_get_serial_sequence('services',    'id'), COALESCE((SELECT MAX(id) FROM services),    1));
SELECT setval(pg_get_serial_sequence('containers',  'id'), COALESCE((SELECT MAX(id) FROM containers),  1));
SELECT setval(pg_get_serial_sequence('customers',   'id'), COALESCE((SELECT MAX(id) FROM customers),   1));
SELECT setval(pg_get_serial_sequence('orders',      'id'), COALESCE((SELECT MAX(id) FROM orders),      1));
SELECT setval(pg_get_serial_sequence('order_items', 'id'), COALESCE((SELECT MAX(id) FROM order_items), 1));

-- ─ Same for the tables seeded with explicit ids in 002_seed.sql ─────────────
SELECT setval(pg_get_serial_sequence('users',         'id'), COALESCE((SELECT MAX(id) FROM users),         1));
SELECT setval(pg_get_serial_sequence('categories',    'id'), COALESCE((SELECT MAX(id) FROM categories),    1));
SELECT setval(pg_get_serial_sequence('brands',        'id'), COALESCE((SELECT MAX(id) FROM brands),        1));
SELECT setval(pg_get_serial_sequence('accounts',      'id'), COALESCE((SELECT MAX(id) FROM accounts),      1));
SELECT setval(pg_get_serial_sequence('used_oil_drum', 'id'), COALESCE((SELECT MAX(id) FROM used_oil_drum), 1));