package app.lubric.desktop.data.shop

import androidx.room.Dao
import androidx.room.Query
import app.lubric.desktop.data.db.SettingEntity
import app.lubric.desktop.data.db.ShopEntity

/**
 * Read-only queries for the Shop Settings screen (`src/modules/shop/Shop.tsx`).
 *
 * The web screen reads the shop row (`SELECT name, address, phone, currency
 * FROM shops WHERE id = 1`) and the whole `settings` table
 * (`SELECT * FROM settings`, folded into a key/value map). There is no
 * matching DAO in Daos.kt: [app.lubric.desktop.data.db.ShopDao] and
 * [app.lubric.desktop.data.db.SettingDao] only expose upsert/count (they
 * serve the sync pull path), so shop reads get their own DAO.
 *
 * NOTE FOR THE COORDINATOR: this DAO needs one accessor in
 * LubricDatabase.kt (a file this package may not edit):
 * `abstract fun shopQueriesDao(): ShopQueriesDao`.
 */
@Dao
interface ShopQueriesDao {

    @Query("SELECT * FROM shops WHERE id = :id LIMIT 1")
    suspend fun shopById(id: Long): ShopEntity?

    /** All settings rows, ordered by key. */
    @Query("SELECT * FROM settings ORDER BY key")
    suspend fun listAllSettings(): List<SettingEntity>

    @Query("SELECT * FROM settings WHERE key = :key LIMIT 1")
    suspend fun settingByKey(key: String): SettingEntity?
}
