package app.lubric.desktop.data.db

/**
 * Sync table metadata, mirroring `SYNC_TABLES`, `PULL_CONFLICT_KEYS` and
 * `SOFT_DELETE_TABLES` in the web app (`src/lib/sync.ts`,
 * `src/lib/outbox.ts`) and `SYNC_TABLES` in `server/index.js`.
 */
object SyncTables {

    /** The 30 tables replicated between the local DB and the cloud. */
    val ALL: List<String> = listOf(
        "products", "services", "customers", "vehicles", "vendors",
        "categories", "brands",
        "orders", "order_items", "expenses", "accounts", "account_transactions",
        "purchase_orders", "vendor_payables", "reminders", "inspections",
        "cash_movements", "reservations",
        "party_ledger", "commitments",
        "stock_movements",
        "price_lists", "price_list_items", "party_price_lists", "party_prices",
        "customer_groups",
        "units", "unit_conversions",
        "warehouses", "warehouse_locations",
    )

    /**
     * Tables whose server row has a `deleted_at` column. Only these get an
     * AFTER DELETE outbox trigger: deleting an append-only ledger row is
     * rejected server-side, so queuing it would retry forever.
     */
    val SOFT_DELETE: Set<String> = setOf(
        "products", "services", "customers", "vehicles", "vendors", "expenses",
    )

    /**
     * Conflict target for a pull upsert, per table. Most tables key on `uuid`;
     * the three uuid-less tables upsert on their natural keys instead.
     */
    val CONFLICT_KEYS: Map<String, List<String>> = mapOf(
        "price_list_items" to listOf("price_list_id", "product_id"),
        "party_price_lists" to listOf("party_type", "party_id", "price_list_id"),
        "party_prices" to listOf("party_type", "party_id", "product_id"),
    )

    /** Conflict keys for a table: its natural keys, or `uuid` by default. */
    fun conflictKeys(table: String): List<String> = CONFLICT_KEYS[table] ?: listOf("uuid")
}
