-- =============================================================
-- 011: Notification / Reminder system
--
-- One unified `reminders` table covers everything the shop needs
-- to be nudged about:
--   service_due      - "John's Corolla is back for its oil change"
--   vendor_meeting   - "Shell distributor, tomorrow 3 PM"
--   credit_followup  - "Ahmed still owes 12,500"
--   todo             - personal reminders / to-do list
--
-- Linked records use ON DELETE SET NULL so the reminder list
-- survives even if a customer/vendor/vehicle row is removed.
-- =============================================================

CREATE TABLE IF NOT EXISTS reminders (
  id                 SERIAL PRIMARY KEY,
  shop_id            INTEGER NOT NULL DEFAULT 1,
  kind               TEXT NOT NULL DEFAULT 'todo'
                     CHECK (kind IN ('service_due','vendor_meeting','todo','credit_followup')),
  title              TEXT NOT NULL,
  details            TEXT NOT NULL DEFAULT '',
  due_at             TIMESTAMPTZ,          -- exact date+time (meetings: "tomorrow 15:00")
  due_km             INTEGER,              -- optional km-based trigger for service reminders
  last_mileage       INTEGER,              -- vehicle mileage when the reminder was created
  customer_id        INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  vehicle_id         INTEGER REFERENCES vehicles(id)  ON DELETE SET NULL,
  vendor_id          INTEGER REFERENCES vendors(id)   ON DELETE SET NULL,
  order_id           INTEGER REFERENCES orders(id)    ON DELETE SET NULL,
  status             TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','done','dismissed')),
  priority           TEXT NOT NULL DEFAULT 'normal'
                     CHECK (priority IN ('low','normal','high')),
  recurrence_days    INTEGER,              -- e.g. 60 -> next one auto-created when done
  completed_at       TIMESTAMPTZ,
  created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reminders_due   ON reminders (shop_id, status, due_at);
CREATE INDEX IF NOT EXISTS idx_reminders_kind  ON reminders (kind);
CREATE INDEX IF NOT EXISTS idx_reminders_cust  ON reminders (customer_id);
CREATE INDEX IF NOT EXISTS idx_reminders_veh   ON reminders (vehicle_id);
CREATE INDEX IF NOT EXISTS idx_reminders_vend  ON reminders (vendor_id);

-- Per-vehicle service intervals so the auto reminder knows the rhythm:
-- "this car comes back every ~60 days / ~3,000 km".
ALTER TABLE vehicles
  ADD COLUMN IF NOT EXISTS service_interval_days INTEGER NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS service_interval_km   INTEGER NOT NULL DEFAULT 3000;

-- ─── A few starters so the notification panel is alive on first run ─────────
-- Guarded with NOT EXISTS so re-running never duplicates anything.

INSERT INTO reminders (shop_id, kind, title, details, due_at, vendor_id, priority, recurrence_days)
SELECT 1, 'vendor_meeting', 'Meeting: ' || ven.name,
       'Monthly stock & pricing review with ' || COALESCE(ven.contact, 'the distributor') || '.',
       date_trunc('day', now()) + interval '1 day' + interval '10 hours',
       ven.id, 'normal', 30
FROM vendors ven
WHERE ven.id = (SELECT MIN(id) FROM vendors)
  AND NOT EXISTS (SELECT 1 FROM reminders r WHERE r.vendor_id = ven.id AND r.status = 'pending');

INSERT INTO reminders (shop_id, kind, title, details, due_at, customer_id, priority)
SELECT 1, 'credit_followup', 'Collect payment: ' || c.name,
       'Outstanding balance: ' || c.credit_balance,
       date_trunc('day', now()) + interval '2 days',
       c.id, 'high'
FROM customers c
WHERE c.credit_balance > 0
  AND NOT EXISTS (SELECT 1 FROM reminders r WHERE r.customer_id = c.id AND r.status = 'pending');

INSERT INTO reminders (shop_id, kind, title, details, due_at, priority)
SELECT 1, 'todo', 'Check used-oil drum level', 'Empty or sell before the drum fills up.',
       date_trunc('day', now()) + interval '3 days' + interval '9 hours',
       'low'
WHERE NOT EXISTS (SELECT 1 FROM reminders r WHERE r.kind = 'todo' AND r.status = 'pending');
