-- Seed default data
INSERT OR IGNORE INTO shops (id, name) VALUES (1, 'Zafar Lubricants');
INSERT OR IGNORE INTO accounts (id, name, type) VALUES (1, 'Shop Cash Drawer', 'cash');
INSERT OR IGNORE INTO accounts (id, name, type) VALUES (2, 'Bank Account', 'bank');
INSERT OR IGNORE INTO used_oil_drum (id, capacity) VALUES (1, 200);

-- Admin user (password: admin123)
INSERT OR IGNORE INTO users (id, email, password_hash, full_name, role) VALUES
  (1, 'admin@lubric.app', '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'Mudassar Naeem', 'admin');
INSERT OR IGNORE INTO users (id, email, password_hash, full_name, role) VALUES
  (2, 'cashier@lubric.app', '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'Counter Staff', 'cashier');

INSERT OR IGNORE INTO role_permissions (role, permission_key) VALUES ('admin', 'all');
INSERT OR IGNORE INTO role_permissions (role, permission_key) VALUES ('cashier', 'pos');
INSERT OR IGNORE INTO role_permissions (role, permission_key) VALUES ('cashier', 'sales_history');
INSERT OR IGNORE INTO role_permissions (role, permission_key) VALUES ('cashier', 'customers');

INSERT OR IGNORE INTO settings (key, value) VALUES ('used_oil_drum_capacity', '200');
INSERT OR IGNORE INTO settings (key, value) VALUES ('manual_price_allowed', 'false');
INSERT OR IGNORE INTO settings (key, value) VALUES ('wholesale_mode', 'qty');
