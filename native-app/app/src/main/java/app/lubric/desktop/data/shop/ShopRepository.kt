package app.lubric.desktop.data.shop

import app.lubric.desktop.data.db.LubricDatabase
import app.lubric.desktop.data.db.ShopEntity

/**
 * Shop repository: read-only in this phase.
 *
 * Mirrors `src/modules/shop/Shop.tsx`: the shop row (name, address, phone,
 * currency, plus the POS configuration columns — used-oil drum capacity,
 * wholesale mode, manual-price flag) and the `settings` table as a key/value
 * map. The web screen also edits both; this phase displays them only — the
 * one write on this screen is Sync now, which belongs to SyncRepository.
 *
 * ShopId scoping happens at the call site: callers pass the active outlet id
 * (an Int, as the session carries it); it is converted to Long here to match
 * the entity primary key.
 */
class ShopRepository(private val db: LubricDatabase) {

    /** The shop row for one outlet, or null when the shop is not stored locally. */
    suspend fun shopDetails(shopId: Int): ShopEntity? =
        db.shopQueriesDao().shopById(shopId.toLong())

    /** All settings rows as a key/value map (value may be null). */
    suspend fun settings(): Map<String, String?> =
        db.shopQueriesDao().listAllSettings().associate { it.key to it.value }

    /** One setting value by key, or null when the key is not stored. */
    suspend fun setting(key: String): String? =
        db.shopQueriesDao().settingByKey(key)?.value
}
