// ─── Core Entity Types ─────────────────────────────────────────────────────────

export interface Shop {
  id: number;
  name: string;
  address: string;
  phone: string;
  currency: string;
  language: string;
  used_oil_drum_capacity: number;
  manual_price_allowed: boolean;
  wholesale_mode: string;
}

export interface User {
  id: number;
  shop_id: number;
  email: string;
  password_hash: string;
  full_name: string;
  role: "admin" | "cashier";
  created_at: string;
}

export interface Category {
  id: number;
  shop_id: number;
  name: string;
  created_at: string;
}

export interface Brand {
  id: number;
  shop_id: number;
  name: string;
  created_at: string;
}

export interface Product {
  id: number;
  shop_id: number;
  sku: string;
  barcode: string;
  name: string;
  brand_id: number | null;
  category_id: number | null;
  packing: string;
  unit: string;
  cost_price: number;
  stock_qty: number;
  low_stock_threshold: number;
  price_returning: number;
  price_walking: number | null;
  price_wholesale: number;
  wholesale_min_qty: number;
  active: number;
  created_at: string;
  // Joined
  category_name?: string;
  brand_name?: string;
}

export interface Service {
  id: number;
  shop_id: number;
  name: string;
  price: number;
  active: number;
  created_at: string;
}

export interface Container {
  id: number;
  shop_id: number;
  product_id: number;
  barcode: string;
  original_volume: number;
  remaining_volume: number;
  status: "full" | "opened" | "empty";
  opened_at: string;
  source_order_id: number | null;
  // Joined
  product_name?: string;
}

export interface Customer {
  id: number;
  shop_id: number;
  name: string;
  phone: string;
  customer_type: "returning" | "walking" | "wholesale";
  credit_balance: number;
  last_visit_at: string | null;
  created_at: string;
}

export interface Vehicle {
  id: number;
  customer_id: number;
  registration: string;
  make: string;
  model: string;
  model_year?: string;
  color?: string;
  condition?: string;
  mileage: number;
  /** How often this car should come back for service (default 60 days). */
  service_interval_days?: number;
  /** How many km it typically covers between services (default 3000). */
  service_interval_km?: number;
  created_at: string;
}

export interface Vendor {
  id: number;
  shop_id: number;
  name: string;
  contact: string;
  phone: string;
  payable_balance: number;
  created_at: string;
}

export interface VendorPayable {
  id: number;
  vendor_id: number;
  amount: number;
  due_date: string | null;
  status: "pending" | "paid" | "partial";
  created_at: string;
}

export interface Account {
  id: number;
  shop_id: number;
  name: string;
  type: "cash" | "bank" | "wallet";
  balance: number;
  active: number;
  created_at: string;
}

export interface AccountTransaction {
  id: number;
  account_id: number;
  amount: number;
  type: "in" | "out" | "transfer_in" | "transfer_out";
  reference: string;
  related_account_id: number | null;
  created_at: string;
  account_name?: string;
}

export interface Order {
  id: number;
  shop_id: number;
  customer_id: number | null;
  user_id: number;
  total: number;
  payment_account_id: number | null;
  payment_method: string;
  status: "draft" | "completed" | "cancelled" | "returned";
  vehicle_id: number | null;
  mileage: number;
  notes: string;
  created_at: string;
  // Joined
  customer_name?: string;
  user_name?: string;
}

export interface OrderItem {
  id: number;
  order_id: number;
  kind: "product" | "service" | "partial_container" | "used_oil";
  ref_id: number;
  product_name: string;
  qty: number;
  unit_price: number;
  line_total: number;
  container_id: number | null;
}

export interface UsedOilDrum {
  id: number;
  shop_id: number;
  current_litres: number;
  capacity: number;
}

export interface UsedOilLog {
  id: number;
  drum_id: number;
  litres: number;
  type: "added" | "removed";
  source_order_id: number | null;
  created_at: string;
}

export interface Expense {
  id: number;
  shop_id: number;
  category: string;
  amount: number;
  account_id: number | null;
  date: string;
  note: string;
  created_at: string;
}

export interface Setting {
  key: string;
  value: string;
}

// ─── Reminders / Notifications ─────────────────────────────────────────────────

export type ReminderKind = "service_due" | "vendor_meeting" | "todo" | "credit_followup";
export type ReminderStatus = "pending" | "done" | "dismissed";
export type ReminderPriority = "low" | "normal" | "high";

export interface Reminder {
  id: number;
  shop_id: number;
  kind: ReminderKind;
  title: string;
  details: string;
  due_at: string | null;
  due_km: number | null;
  last_mileage: number | null;
  customer_id: number | null;
  vehicle_id: number | null;
  vendor_id: number | null;
  order_id: number | null;
  status: ReminderStatus;
  priority: ReminderPriority;
  recurrence_days: number | null;
  completed_at: string | null;
  created_by_user_id: number | null;
  created_at: string;
  updated_at: string;
  // Joined
  customer_name?: string | null;
  vendor_name?: string | null;
  vehicle_label?: string | null;
}

// ─── POS Types ─────────────────────────────────────────────────────────────────

export type CustomerType = "returning" | "walking" | "wholesale";

export interface CartItem {
  id: string; // unique local id
  kind: "product" | "service" | "partial_container" | "used_oil";
  ref_id: number;
  name: string;
  qty: number;
  unit_price: number;
  line_total: number;
  container_id?: number | null;
  max_qty?: number;
  product?: Product;
  /** Litres left in the bottle after the sale — recorded as a container, never billed. */
  leftover?: number;
  /** Engine oil capacity in litres, e.g. 3.5. Drives the leftover calculation. */
  capacity?: number;
  /** true (default) = bill pro-rata for the litres the engine actually took. */
  billByCapacity?: boolean;
  /** true = unused oil goes to the containers shelf; false = customer takes it home. */
  leftoverToContainers?: boolean;
}

export interface SalePayload {
  customer_id: number | null;
  customer_type: CustomerType;
  vehicle_id?: number;
  mileage?: number;
  payment_account_id: number;
  payment_method: string;
  items: CartItem[];
  notes: string;
}
