package app.lubric.desktop.data.dashboard

import app.lubric.desktop.data.db.AccountEntity
import app.lubric.desktop.data.db.LubricDatabase
import app.lubric.desktop.data.db.ProductEntity

/**
 * Dashboard aggregates, all read from local Room (offline-first). The web
 * dashboard reads the same figures from `orders` / `products` /
 * `reminders` / `accounts` (survey §7 route 1).
 */
class DashboardRepository(private val db: LubricDatabase) {

    data class DashboardData(
        /** Completed sales today (local date). */
        val todayTotal: Double,
        val todayCount: Int,
        /** Active products at or below their low-stock threshold. */
        val lowStock: List<ProductEntity>,
        /** Reminders still pending. */
        val pendingReminders: Int,
        /** Active accounts with their balances. */
        val accounts: List<AccountEntity>,
    )

    suspend fun load(): DashboardData = DashboardData(
        todayTotal = db.orderDao().todayTotal(),
        todayCount = db.orderDao().todayCount(),
        lowStock = db.productDao().listLowStock(),
        pendingReminders = db.reminderDao().pendingCount(),
        accounts = db.accountDao().listActive(),
    )
}
