-- Seed data for Lubric POS (PostgreSQL)
-- Uses ON CONFLICT DO NOTHING instead of INSERT OR IGNORE

INSERT INTO shops (id, name, currency) VALUES (1, 'Zafar Lubricants', 'PKR') ON CONFLICT (id) DO NOTHING;
INSERT INTO accounts (id, name, type) VALUES (1, 'Shop Cash Drawer', 'cash') ON CONFLICT (id) DO NOTHING;
INSERT INTO accounts (id, name, type) VALUES (2, 'Bank Account', 'bank') ON CONFLICT (id) DO NOTHING;
INSERT INTO used_oil_drum (id, capacity) VALUES (1, 200) ON CONFLICT (id) DO NOTHING;
INSERT INTO users (id, email, password_hash, full_name, role) VALUES (1, 'admin@lubric.app', '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'Mudassar Naeem', 'admin') ON CONFLICT (id) DO NOTHING;
INSERT INTO users (id, email, password_hash, full_name, role) VALUES (2, 'cashier@lubric.app', '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'Counter Staff', 'cashier') ON CONFLICT (id) DO NOTHING;
INSERT INTO role_permissions (role, permission_key) VALUES ('admin', 'all') ON CONFLICT (role, permission_key) DO NOTHING;
INSERT INTO role_permissions (role, permission_key) VALUES ('cashier', 'pos') ON CONFLICT (role, permission_key) DO NOTHING;
INSERT INTO role_permissions (role, permission_key) VALUES ('cashier', 'sales_history') ON CONFLICT (role, permission_key) DO NOTHING;
INSERT INTO role_permissions (role, permission_key) VALUES ('cashier', 'customers') ON CONFLICT (role, permission_key) DO NOTHING;
INSERT INTO categories (id, name) VALUES (1, 'Engine Oil') ON CONFLICT (id) DO NOTHING;
INSERT INTO categories (id, name) VALUES (2, 'Gear Oil') ON CONFLICT (id) DO NOTHING;
INSERT INTO categories (id, name) VALUES (3, 'Hydraulic Oil') ON CONFLICT (id) DO NOTHING;
INSERT INTO categories (id, name) VALUES (4, 'Transmission Fluid') ON CONFLICT (id) DO NOTHING;
INSERT INTO categories (id, name) VALUES (5, 'Coolant') ON CONFLICT (id) DO NOTHING;
INSERT INTO categories (id, name) VALUES (6, 'Grease') ON CONFLICT (id) DO NOTHING;
INSERT INTO categories (id, name) VALUES (7, 'Additives') ON CONFLICT (id) DO NOTHING;
INSERT INTO categories (id, name) VALUES (8, 'Filters') ON CONFLICT (id) DO NOTHING;
INSERT INTO categories (id, name) VALUES (9, 'Other') ON CONFLICT (id) DO NOTHING;
INSERT INTO brands (id, name) VALUES (1, 'Shell') ON CONFLICT (id) DO NOTHING;
INSERT INTO brands (id, name) VALUES (2, 'Mobil') ON CONFLICT (id) DO NOTHING;
INSERT INTO brands (id, name) VALUES (3, 'Castrol') ON CONFLICT (id) DO NOTHING;
INSERT INTO brands (id, name) VALUES (4, 'Valvoline') ON CONFLICT (id) DO NOTHING;
INSERT INTO brands (id, name) VALUES (5, 'Total') ON CONFLICT (id) DO NOTHING;
INSERT INTO brands (id, name) VALUES (6, 'Lubriguard') ON CONFLICT (id) DO NOTHING;
INSERT INTO brands (id, name) VALUES (7, 'Local') ON CONFLICT (id) DO NOTHING;
INSERT INTO settings (key, value) VALUES ('db_version', '2') ON CONFLICT (key) DO NOTHING;
INSERT INTO settings (key, value) VALUES ('manual_price_allowed', 'false') ON CONFLICT (key) DO NOTHING;
INSERT INTO settings (key, value) VALUES ('wholesale_mode', 'qty') ON CONFLICT (key) DO NOTHING;
