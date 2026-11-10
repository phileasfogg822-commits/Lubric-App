package app.lubric.desktop.data.db

import androidx.sqlite.db.SupportSQLiteDatabase

/**
 * Outbox triggers — the offline write hook, mirroring `src/lib/outbox.ts`.
 *
 * Room cannot declare triggers via annotations, so they are created with
 * raw SQL: on database create/open ([LubricDatabase]), and dropped /
 * recreated around every pull by
 * [app.lubric.desktop.data.sync.SyncRepository] so pulled rows do not
 * queue straight back up for the next push.
 *
 * The SQL is exactly what `buildTriggerSql` in outbox.ts produces:
 * AFTER INSERT / AFTER UPDATE on every uuid-bearing sync table (plus AFTER
 * DELETE only for the six soft-delete tables), payload =
 * `json_object` of all columns except `id`, gated by
 * `WHEN NEW.uuid IS NOT NULL`. `json_object` with a NULL value produces
 * JSON null — that matches the web behaviour; do not special-case it.
 *
 * The three uuid-less tables (price_list_items, party_price_lists,
 * party_prices) get no triggers: a row cannot be queued without an
 * identity, exactly as in the web app.
 */
object OutboxTriggers {

    /** Table columns (minus `id`) for every uuid-bearing sync table. */
    val TABLE_COLUMNS: Map<String, List<String>> = mapOf(
        "products" to listOf(
            "shop_id", "sku", "barcode", "name", "brand_id", "category_id",
            "packing", "unit", "variant", "mfd_date", "exp_date", "offer",
            "cost_price", "stock_qty", "low_stock_threshold", "price_returning",
            "price_walking", "price_wholesale", "wholesale_min_qty", "active",
            "created_at", "vendor_id", "received_date", "unit_id", "uuid",
            "updated_at", "deleted_at",
        ),
        "services" to listOf(
            "shop_id", "name", "price", "active", "created_at", "uuid",
            "updated_at", "deleted_at",
        ),
        "customers" to listOf(
            "shop_id", "name", "phone", "customer_type", "credit_balance",
            "last_visit_at", "created_at", "group_id", "uuid", "updated_at",
            "deleted_at",
        ),
        "vehicles" to listOf(
            "customer_id", "registration", "make", "model", "model_year",
            "color", "condition", "oil_capacity", "mileage", "created_at",
            "service_interval_days", "service_interval_km", "uuid",
            "updated_at", "deleted_at", "shop_id",
        ),
        "vendors" to listOf(
            "shop_id", "name", "contact", "phone", "payable_balance",
            "created_at", "uuid", "updated_at", "deleted_at",
        ),
        "categories" to listOf("shop_id", "name", "created_at", "uuid", "updated_at"),
        "brands" to listOf("shop_id", "name", "created_at", "uuid", "updated_at"),
        "orders" to listOf(
            "shop_id", "customer_id", "user_id", "total", "paid_amount",
            "payment_account_id", "payment_method", "status", "vehicle_id",
            "mileage", "notes", "created_at", "uuid", "updated_at",
            "converted_from_commitment_id",
        ),
        "order_items" to listOf(
            "order_id", "kind", "ref_id", "uuid", "shop_id", "product_name",
            "qty", "unit_price", "line_total", "container_id", "capacity",
            "leftover_litres", "leftover_to", "leftover_released",
            "billed_by_capacity", "updated_at",
        ),
        "expenses" to listOf(
            "shop_id", "category", "subcategory", "amount", "account_id",
            "date", "note", "created_at", "uuid", "updated_at", "deleted_at",
        ),
        "accounts" to listOf(
            "shop_id", "name", "type", "balance", "active", "created_at",
            "uuid", "updated_at", "account_class", "code",
        ),
        "account_transactions" to listOf(
            "account_id", "amount", "type", "reference", "related_account_id",
            "created_at", "uuid", "updated_at", "shop_id",
        ),
        "purchase_orders" to listOf(
            "shop_id", "vendor_id", "total", "paid", "status", "notes",
            "created_at", "uuid", "updated_at",
        ),
        "vendor_payables" to listOf(
            "vendor_id", "amount", "due_date", "status", "created_at", "uuid",
            "shop_id", "updated_at",
        ),
        "reminders" to listOf(
            "shop_id", "kind", "title", "details", "due_at", "due_km",
            "last_mileage", "customer_id", "vehicle_id", "vendor_id",
            "order_id", "priority", "recurrence_days", "status",
            "completed_at", "created_by_user_id", "created_at", "updated_at",
            "uuid",
        ),
        "inspections" to listOf(
            "shop_id", "customer_id", "vehicle_id", "data", "notes", "user_id",
            "created_at", "order_id", "inspection_data", "uuid", "updated_at",
        ),
        "cash_movements" to listOf(
            "uuid", "shop_id", "kind", "amount", "customer_id",
            "customer_name", "customer_uuid", "vendor_id", "order_id",
            "account_id", "taken_by_user_id", "taken_by_device_id",
            "taken_by_name", "posted_at", "note", "occurred_at", "origin",
            "created_at", "updated_at",
        ),
        "reservations" to listOf(
            "uuid", "shop_id", "customer_id", "customer_name", "items_json",
            "amount", "status", "fulfilled_order_id", "created_by_user_id",
            "note", "origin", "created_at", "updated_at", "taken_by_name",
        ),
        "party_ledger" to listOf(
            "uuid", "shop_id", "party_type", "party_id", "kind", "direction",
            "amount", "order_id", "vendor_payable_id", "cash_movement_id",
            "commitment_id", "note", "occurred_at", "origin", "created_at",
            "updated_at",
        ),
        "commitments" to listOf(
            "uuid", "shop_id", "party_type", "party_id", "status", "total",
            "notes", "taken_by_user_id", "converted_order_id", "occurred_at",
            "origin", "created_at", "updated_at",
        ),
        "stock_movements" to listOf(
            "uuid", "shop_id", "item_id", "kind", "qty", "qty_after",
            "ref_table", "ref_id", "warehouse_id", "note", "occurred_at",
            "created_by_user_id", "created_at", "updated_at", "location_id",
        ),
        "price_lists" to listOf(
            "uuid", "shop_id", "name", "code", "is_default", "markup_pct",
            "rounding_mode", "rounding_value", "active", "created_at",
            "updated_at",
        ),
        "customer_groups" to listOf(
            "uuid", "shop_id", "name", "code", "price_tier", "price_list_id",
            "credit_days", "credit_limit", "colour", "active", "created_at",
            "updated_at",
        ),
        "units" to listOf(
            "uuid", "shop_id", "name", "plural", "abbreviation", "dimension",
            "decimal_places", "litres_each", "active", "created_at",
            "updated_at",
        ),
        "unit_conversions" to listOf(
            "uuid", "from_unit_id", "to_unit_id", "multiplier", "created_at",
        ),
        "warehouses" to listOf(
            "uuid", "shop_id", "name", "code", "address", "is_default",
            "active", "created_at", "updated_at",
        ),
        "warehouse_locations" to listOf(
            "uuid", "warehouse_id", "shop_id", "name", "code", "kind",
            "active", "created_at", "updated_at",
        ),
    )

    fun triggerName(table: String, op: String): String = "trg_${table}_$op"

    private fun jsonPairs(columns: List<String>, alias: String): String =
        columns.joinToString(", ") { "'$it', $alias.$it" }

    /**
     * The CREATE TRIGGER statements for one table: ins + upd, plus del only
     * for soft-delete tables. Empty for a table with no uuid column.
     */
    fun buildTriggerSql(table: String, columns: List<String>): List<String> {
        if (!columns.contains("uuid")) return emptyList()
        val cols = columns.filter { it != "id" }
        val out = mutableListOf(
            "CREATE TRIGGER IF NOT EXISTS ${triggerName(table, "ins")} " +
                "AFTER INSERT ON $table WHEN NEW.uuid IS NOT NULL BEGIN " +
                "INSERT INTO sync_outbox (table_name, row_uuid, op, payload) " +
                "VALUES ('$table', NEW.uuid, 'insert', " +
                "json_object(${jsonPairs(cols, "NEW")})); END;",
            "CREATE TRIGGER IF NOT EXISTS ${triggerName(table, "upd")} " +
                "AFTER UPDATE ON $table WHEN NEW.uuid IS NOT NULL BEGIN " +
                "INSERT INTO sync_outbox (table_name, row_uuid, op, payload) " +
                "VALUES ('$table', NEW.uuid, 'update', " +
                "json_object(${jsonPairs(cols, "NEW")})); END;",
        )
        if (SyncTables.SOFT_DELETE.contains(table)) {
            out += "CREATE TRIGGER IF NOT EXISTS ${triggerName(table, "del")} " +
                "AFTER DELETE ON $table WHEN OLD.uuid IS NOT NULL BEGIN " +
                "INSERT INTO sync_outbox (table_name, row_uuid, op, payload) " +
                "VALUES ('$table', OLD.uuid, 'delete', " +
                "json_object(${jsonPairs(cols, "OLD")})); END;"
        }
        return out
    }

    fun dropTriggerSql(table: String): List<String> =
        listOf("ins", "upd", "del").map { op ->
            "DROP TRIGGER IF EXISTS ${triggerName(table, op)}"
        }

    /** Create (idempotently) the outbox triggers for every uuid sync table. */
    fun create(db: SupportSQLiteDatabase) {
        for ((table, columns) in TABLE_COLUMNS) {
            for (sql in buildTriggerSql(table, columns)) {
                db.execSQL(sql)
            }
        }
    }

    /** Drop the outbox triggers for every sync table. */
    fun drop(db: SupportSQLiteDatabase) {
        for (table in SyncTables.ALL) {
            for (sql in dropTriggerSql(table)) {
                db.execSQL(sql)
            }
        }
    }
}
