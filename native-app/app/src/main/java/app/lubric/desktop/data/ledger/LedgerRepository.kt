package app.lubric.desktop.data.ledger

import android.database.Cursor
import androidx.room.withTransaction
import androidx.sqlite.db.SimpleSQLiteQuery
import androidx.sqlite.db.SupportSQLiteDatabase
import app.lubric.desktop.data.db.AccountTransactionEntity
import app.lubric.desktop.data.db.LubricDatabase
import app.lubric.desktop.data.db.PartyLedgerEntity
import app.lubric.desktop.data.db.PayableAllocationEntity
import app.lubric.desktop.data.db.VendorPayableEntity
import app.lubric.desktop.data.pricing.round2
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

// ---------------------------------------------------------------------------
// Pure khata arithmetic (web: src/lib/ledgerSql.ts, src/modules/ledger/statement.ts)
// No Room/Android imports below the line — unit-testable on the JVM.
// ---------------------------------------------------------------------------

/**
 * One party_ledger row as read for a statement. `direction` is "debit" or
 * "credit"; `amount` is always positive.
 */
data class LedgerEntry(
    val id: Long,
    val uuid: String?,
    val kind: String,
    val direction: String,
    val amount: Double,
    val note: String,
    val occurredAt: String?,
    val orderId: Int?,
    val vendorPayableId: Int?,
)

/** A statement row with its running balance (absolute, not period-relative). */
data class StatementEntry(
    val entry: LedgerEntry,
    val running: Double,
)

/** One open vendor payable with what allocations have already settled. */
data class OpenPayable(
    val id: Long,
    val amount: Double,
    val settled: Double,
)

/** How much of a payment went against one payable, and its new status. */
data class PayableSettlement(
    val id: Long,
    val amount: Double,
    val status: String, // "paid" | "partial"
)

/** Billed vs settled for one "YYYY-MM" month bucket, newest first. */
data class MonthlyRow(
    val month: String,
    val billed: Double,
    val settled: Double,
    val entries: Int,
)

/** One party (customer or vendor) with its ledger-derived balance. */
data class PartyBalanceRow(
    val partyId: Long,
    val name: String,
    val phone: String,
    /** Positive = they owe us (customer) or we owe them (vendor). */
    val balance: Double,
    val lastEntryAt: String?,
)

/** A statement over a period, with its opening balance carried in. */
data class StatementView(
    val rows: List<StatementEntry>,
    /** Balance carried into the period — the statement's "balance b/d". */
    val opening: Double,
    val totalDebit: Double,
    val totalCredit: Double,
    /** Current balance, all periods — the figure the shop is owed / owes. */
    val balance: Double,
)

/**
 * DIRECTION SEMANTICS (web ledgerSql.ts, identical for both party types):
 * a debit INCREASES what is owed, a credit DECREASES it, so a party's
 * balance is always SUM(debit) - SUM(credit). Positive means money is owed.
 */
fun signedAmount(direction: String, amount: Double): Double =
    if (direction == "debit") amount else -amount

/** Balance derived from ledger entries: SUM(debit) - SUM(credit). */
fun partyBalanceFromEntries(entries: List<LedgerEntry>): Double =
    round2(entries.sumOf { signedAmount(it.direction, it.amount) })

/**
 * Attach the running balance to each entry, oldest first.
 *
 * [opening] is the balance before the first entry (the "balance b/d");
 * the running figure on a row is the ABSOLUTE balance after that row,
 * matching the web statement query, whose running subquery sums every
 * row up to the current one regardless of the period filter.
 */
fun withRunningBalances(opening: Double, entries: List<LedgerEntry>): List<StatementEntry> {
    var running = round2(opening)
    return entries.map { entry ->
        running = round2(running + signedAmount(entry.direction, entry.amount))
        StatementEntry(entry, running)
    }
}

/**
 * Spread a payment over open payables, oldest due first — how a shop
 * actually settles a supplier (web `allocatePayables`). Pure: anything
 * left over is an advance and simply stays unallocated.
 */
fun allocatePayables(payables: List<OpenPayable>, amount: Double): List<PayableSettlement> {
    var left = round2(amount)
    val out = mutableListOf<PayableSettlement>()
    for (p in payables) {
        if (left <= 0.005) break
        val outstanding = round2(p.amount - p.settled)
        if (outstanding <= 0.005) continue
        val applied = round2(minOf(outstanding, left))
        val covered = round2(p.settled + applied) >= round2(p.amount) - 0.005
        out += PayableSettlement(id = p.id, amount = applied, status = if (covered) "paid" else "partial")
        left = round2(left - applied)
    }
    return out
}

/** Payment amounts must be > 0 (web `recordPayment` message). */
fun validatePaymentAmount(amount: Double): Double {
    val rounded = round2(amount)
    require(rounded > 0) { "Enter a payment amount greater than zero" }
    return rounded
}

/** Bill amounts must be > 0 (web `recordBill` message). */
fun validateBillAmount(amount: Double): Double {
    val rounded = round2(amount)
    require(rounded > 0) { "Enter an amount greater than zero" }
    return rounded
}

/** "YYYY-MM" for a month bucket: the first seven characters of the ISO date. */
fun monthKey(occurredAt: String?): String = occurredAt?.take(7) ?: ""

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

/**
 * Khata repository: party balances, statements, monthly billed-vs-settled,
 * and the two writes — recordPayment and recordBill.
 *
 * Mirrors the web app (`src/lib/ledger.ts`, `src/lib/ledgerSql.ts`):
 * every balance is DERIVED from party_ledger; the denormalised
 * `customers.credit_balance` / `vendors.payable_balance` caches are kept
 * in step by the same transaction. A payment is always a CREDIT (it
 * reduces what the customer owes us, and what we owe the vendor); a bill
 * is always a DEBIT. For vendors a payment settles the oldest open
 * payables FIFO and writes `payable_allocations` rows; a bill also opens
 * a `vendor_payables` row with its due date.
 *
 * Writes run inside one [withTransaction] block — the repository-level
 * equivalent of Room `@Transaction` (which can only annotate DAO
 * methods); this is the same mechanism `CatalogRepository` and
 * `SyncRepository` already use. All writes go through DAO upserts, so
 * the existing outbox triggers queue them for sync; no `sync_outbox`
 * row is ever written by hand. Money is rounded with [round2] at the
 * same points the web does.
 *
 * Reads use raw queries for the rows no existing DAO exposes (ledger
 * aggregates, monthly buckets, party lists) — the same SQL as the web
 * queries, translated to SQLite (`substr(occurred_at, 1, 7)` for the
 * monthly bucket instead of Postgres `date_trunc`).
 */
class LedgerRepository(private val db: LubricDatabase) {

    private fun requirePartyType(partyType: String) {
        require(partyType == "customer" || partyType == "vendor") {
            "Unknown party type: $partyType"
        }
    }

    /** Every customer (or vendor) with their ledger balance, name order. */
    suspend fun listParties(partyType: String): List<PartyBalanceRow> {
        requirePartyType(partyType)
        val table = if (partyType == "customer") "customers" else "vendors"
        val cursor = db.openHelper.readableDatabase.query(
            SimpleSQLiteQuery(
                "SELECT p.id AS party_id, p.name, p.phone, " +
                    "COALESCE(SUM(CASE WHEN l.direction = 'debit' THEN l.amount " +
                    "ELSE -l.amount END), 0) AS balance, " +
                    "MAX(l.occurred_at) AS last_entry_at " +
                    "FROM $table p LEFT JOIN party_ledger l " +
                    "ON l.party_type = ? AND l.party_id = p.id " +
                    "WHERE p.deleted_at IS NULL " +
                    "GROUP BY p.id, p.name, p.phone ORDER BY p.name",
                arrayOf(partyType),
            ),
        )
        return cursor.use { mapPartyBalances(it) }
    }

    /** Current derived balance for one party. */
    suspend fun partyBalance(partyType: String, partyId: Long): Double {
        requirePartyType(partyType)
        return round2(queryBalance(db.openHelper.readableDatabase, partyType, partyId))
    }

    /** The statement for one party, oldest first, with running balances. */
    suspend fun statement(
        partyType: String,
        partyId: Long,
        from: String? = null,
        to: String? = null,
    ): StatementView {
        requirePartyType(partyType)
        val readable = db.openHelper.readableDatabase
        val entries = queryStatementRows(readable, partyType, partyId, from, to)
        val opening = if (from != null) {
            round2(queryBalanceBefore(readable, partyType, partyId, from))
        } else {
            0.0
        }
        val rows = withRunningBalances(opening, entries)
        val totalDebit = round2(entries.filter { it.direction == "debit" }.sumOf { it.amount })
        val totalCredit = round2(entries.filter { it.direction == "credit" }.sumOf { it.amount })
        return StatementView(
            rows = rows,
            opening = opening,
            totalDebit = totalDebit,
            totalCredit = totalCredit,
            balance = round2(queryBalance(readable, partyType, partyId)),
        )
    }

    /** Billed vs settled per month, newest first (default last 6 months). */
    suspend fun monthlySummary(
        partyType: String,
        partyId: Long,
        months: Int = 6,
    ): List<MonthlyRow> {
        requirePartyType(partyType)
        val cursor = db.openHelper.readableDatabase.query(
            SimpleSQLiteQuery(
                "SELECT substr(l.occurred_at, 1, 7) AS month, " +
                    "COALESCE(SUM(CASE WHEN l.direction = 'debit' THEN l.amount ELSE 0 END), 0) AS billed, " +
                    "COALESCE(SUM(CASE WHEN l.direction = 'credit' THEN l.amount ELSE 0 END), 0) AS settled, " +
                    "COUNT(*) AS entries FROM party_ledger l " +
                    "WHERE l.party_type = ? AND l.party_id = ? " +
                    "GROUP BY substr(l.occurred_at, 1, 7) " +
                    "ORDER BY month DESC LIMIT ?",
                arrayOf(partyType, partyId, months),
            ),
        )
        return cursor.use { mapMonthly(it) }
    }

    /** Active cash/bank accounts a payment can be booked to. */
    suspend fun accounts() = db.accountDao().listActive()

    /**
     * Record money changing hands. One transaction: the ledger row (credit),
     * the party's balance cache, the account movement, and — for vendors —
     * the FIFO settlement of the oldest open payables with
     * `payable_allocations` rows. Returns the payment row's uuid.
     *
     * A customer paying us is money IN; us paying a vendor is money OUT.
     * `accountId` null means "not booked to an account" (web behaviour).
     */
    suspend fun recordPayment(
        partyType: String,
        partyId: Long,
        amount: Double,
        accountId: Long?,
        note: String,
        shopId: Int,
        occurredAt: String = LocalDate.now().toString(),
    ): String {
        requirePartyType(partyType)
        val rounded = validatePaymentAmount(amount)
        val partyName = partyName(partyType, partyId)
        val reference = if (partyType == "customer") "Payment from $partyName" else "Payment to $partyName"
        val finalNote = note.trim().ifBlank { reference }

        // A vendor payment settles the oldest invoices first; a customer
        // payment has no invoices to allocate to. (Web reads the open
        // payables before the transaction, too.)
        val settle: List<PayableSettlement> =
            if (partyType == "vendor") {
                allocatePayables(queryOpenPayables(partyId), rounded)
            } else {
                emptyList()
            }

        val paymentUuid = UUID.randomUUID().toString()
        val now = Instant.now().toString()
        db.withTransaction {
            val writable = db.openHelper.writableDatabase
            db.partyLedgerDao().upsert(
                PartyLedgerEntity(
                    uuid = paymentUuid,
                    shopId = shopId,
                    partyType = partyType,
                    partyId = partyId.toInt(),
                    kind = "payment",
                    direction = "credit",
                    amount = rounded,
                    vendorPayableId = settle.firstOrNull()?.id?.toInt(),
                    note = finalNote,
                    occurredAt = occurredAt,
                    origin = "shop",
                    updatedAt = now,
                ),
            )
            stepBalanceCache(partyType, partyId, -rounded, now)

            if (accountId != null) {
                val account = db.accountDao().getById(accountId)
                    ?: throw IllegalArgumentException("Account not found")
                val incoming = partyType == "customer"
                db.accountDao().upsert(
                    account.copy(
                        balance = round2((account.balance ?: 0.0) + if (incoming) rounded else -rounded),
                        updatedAt = now,
                    ),
                )
                db.accountTransactionDao().upsert(
                    AccountTransactionEntity(
                        accountId = accountId.toInt(),
                        amount = rounded,
                        type = if (incoming) "in" else "out",
                        reference = finalNote,
                        uuid = UUID.randomUUID().toString(),
                        shopId = shopId,
                        updatedAt = now,
                    ),
                )
            }

            for (s in settle) {
                val payable = queryPayableById(writable, s.id)
                    ?: throw IllegalArgumentException("Payable not found")
                db.vendorPayableDao().upsert(
                    payable.copy(status = s.status, updatedAt = now),
                )
                db.payableAllocationDao().upsert(
                    PayableAllocationEntity(
                        shopId = shopId,
                        paymentUuid = paymentUuid,
                        vendorPayableId = s.id.toInt(),
                        amount = s.amount,
                    ),
                )
            }
        }
        return paymentUuid
    }

    /**
     * Record goods/services on account — the udhaar. One transaction: the
     * ledger row (debit), the party's balance cache, and — for vendors —
     * a `vendor_payables` row with its due date, linked from the ledger
     * row. No money changes hands, so no account is touched.
     * Returns the bill row's uuid.
     */
    suspend fun recordBill(
        partyType: String,
        partyId: Long,
        amount: Double,
        note: String,
        dueDate: String? = null,
        shopId: Int,
        occurredAt: String = LocalDate.now().toString(),
    ): String {
        requirePartyType(partyType)
        val rounded = validateBillAmount(amount)
        partyName(partyType, partyId) // Throws when the party does not exist.
        val finalNote = note.trim().ifBlank {
            if (partyType == "customer") "Goods on account" else "Purchase on account"
        }

        val billUuid = UUID.randomUUID().toString()
        val now = Instant.now().toString()
        db.withTransaction {
            val writable = db.openHelper.writableDatabase
            var payableId: Int? = null
            if (partyType == "vendor") {
                // The ledger row links the payable inserted just above.
                // Inside one transaction the newest id for that vendor is
                // the row we wrote (same MAX(id)+1 convention the sale
                // flow uses for order ids; single-device local DB).
                db.vendorPayableDao().upsert(
                    VendorPayableEntity(
                        vendorId = partyId.toInt(),
                        amount = rounded,
                        dueDate = dueDate,
                        status = "pending",
                        uuid = UUID.randomUUID().toString(),
                        shopId = shopId,
                        updatedAt = now,
                    ),
                )
                payableId = queryMaxPayableId(writable, partyId)
            }
            db.partyLedgerDao().upsert(
                PartyLedgerEntity(
                    uuid = billUuid,
                    shopId = shopId,
                    partyType = partyType,
                    partyId = partyId.toInt(),
                    kind = "bill",
                    direction = "debit",
                    amount = rounded,
                    vendorPayableId = payableId,
                    note = finalNote,
                    occurredAt = occurredAt,
                    origin = "shop",
                    updatedAt = now,
                ),
            )
            stepBalanceCache(partyType, partyId, rounded, now)
        }
        return billUuid
    }

    // -- Helpers ------------------------------------------------------------

    private suspend fun partyName(partyType: String, partyId: Long): String {
        val name = if (partyType == "customer") {
            db.customerDao().getById(partyId)?.name
        } else {
            db.vendorDao().getById(partyId)?.name
        }
        return name ?: throw IllegalArgumentException("Party not found")
    }

    /** Move the denormalised party balance in step with the ledger. */
    private suspend fun stepBalanceCache(
        partyType: String,
        partyId: Long,
        delta: Double,
        now: String,
    ) {
        if (partyType == "customer") {
            val customer = db.customerDao().getById(partyId)
                ?: throw IllegalArgumentException("Party not found")
            db.customerDao().upsert(
                customer.copy(
                    creditBalance = round2((customer.creditBalance ?: 0.0) + delta),
                    updatedAt = now,
                ),
            )
        } else {
            val vendor = db.vendorDao().getById(partyId)
                ?: throw IllegalArgumentException("Party not found")
            db.vendorDao().upsert(
                vendor.copy(
                    payableBalance = round2((vendor.payableBalance ?: 0.0) + delta),
                    updatedAt = now,
                ),
            )
        }
    }

    private fun queryOpenPayables(vendorId: Long): List<OpenPayable> {
        val cursor = db.openHelper.readableDatabase.query(
            SimpleSQLiteQuery(
                "SELECT vp.id, vp.amount, " +
                    "COALESCE((SELECT SUM(a.amount) FROM payable_allocations a " +
                    "WHERE a.vendor_payable_id = vp.id), 0) AS settled " +
                    "FROM vendor_payables vp " +
                    "WHERE vp.vendor_id = ? AND vp.status IN ('pending', 'partial') " +
                    "ORDER BY (vp.due_date IS NULL), vp.due_date, vp.id",
                arrayOf(vendorId),
            ),
        )
        return cursor.use { mapOpenPayables(it) }
    }

    private fun queryBalance(
        sqlite: SupportSQLiteDatabase,
        partyType: String,
        partyId: Long,
    ): Double = querySignedSum(sqlite, partyType, partyId, before = null)

    private fun queryBalanceBefore(
        sqlite: SupportSQLiteDatabase,
        partyType: String,
        partyId: Long,
        before: String,
    ): Double = querySignedSum(sqlite, partyType, partyId, before = before)

    private fun querySignedSum(
        sqlite: SupportSQLiteDatabase,
        partyType: String,
        partyId: Long,
        before: String?,
    ): Double {
        val sql = StringBuilder(
            "SELECT COALESCE(SUM(CASE WHEN direction = 'debit' THEN amount " +
                "ELSE -amount END), 0) FROM party_ledger " +
                "WHERE party_type = ? AND party_id = ?",
        )
        val args = mutableListOf<Any?>(partyType, partyId)
        if (before != null) {
            sql.append(" AND occurred_at < ?")
            args += before
        }
        val cursor = sqlite.query(SimpleSQLiteQuery(sql.toString(), args.toTypedArray()))
        return cursor.use { if (it.moveToFirst()) it.getDouble(0) else 0.0 }
    }

    private fun queryStatementRows(
        sqlite: SupportSQLiteDatabase,
        partyType: String,
        partyId: Long,
        from: String?,
        to: String?,
    ): List<LedgerEntry> {
        val sql = StringBuilder(
            "SELECT id, uuid, kind, direction, amount, note, occurred_at, " +
                "order_id, vendor_payable_id FROM party_ledger " +
                "WHERE party_type = ? AND party_id = ?",
        )
        val args = mutableListOf<Any?>(partyType, partyId)
        if (from != null) {
            sql.append(" AND occurred_at >= ?")
            args += from
        }
        if (to != null) {
            sql.append(" AND occurred_at <= ?")
            args += to
        }
        sql.append(" ORDER BY occurred_at, id")
        val cursor = sqlite.query(SimpleSQLiteQuery(sql.toString(), args.toTypedArray()))
        return cursor.use { mapLedgerEntries(it) }
    }

    private fun queryPayableById(
        sqlite: SupportSQLiteDatabase,
        id: Long,
    ): VendorPayableEntity? {
        val cursor = sqlite.query(
            SimpleSQLiteQuery(
                "SELECT id, vendor_id, amount, due_date, status, created_at, " +
                    "uuid, shop_id, updated_at FROM vendor_payables WHERE id = ? LIMIT 1",
                arrayOf(id),
            ),
        )
        return cursor.use {
            if (!it.moveToFirst()) null else mapPayableRow(it)
        }
    }

    private fun queryMaxPayableId(sqlite: SupportSQLiteDatabase, vendorId: Long): Int? {
        val cursor = sqlite.query(
            SimpleSQLiteQuery(
                "SELECT MAX(id) FROM vendor_payables WHERE vendor_id = ?",
                arrayOf(vendorId),
            ),
        )
        return cursor.use {
            if (!it.moveToFirst() || it.isNull(0)) null else it.getInt(0)
        }
    }

    // -- Cursor mapping -----------------------------------------------------

    private fun mapPartyBalances(cursor: Cursor): List<PartyBalanceRow> {
        val out = mutableListOf<PartyBalanceRow>()
        val idCol = cursor.getColumnIndexOrThrow("party_id")
        val nameCol = cursor.getColumnIndexOrThrow("name")
        val phoneCol = cursor.getColumnIndexOrThrow("phone")
        val balanceCol = cursor.getColumnIndexOrThrow("balance")
        val lastCol = cursor.getColumnIndexOrThrow("last_entry_at")
        while (cursor.moveToNext()) {
            out += PartyBalanceRow(
                partyId = cursor.getLong(idCol),
                name = cursor.getString(nameCol) ?: "",
                phone = cursor.getString(phoneCol) ?: "",
                balance = round2(cursor.getDouble(balanceCol)),
                lastEntryAt = if (cursor.isNull(lastCol)) null else cursor.getString(lastCol),
            )
        }
        return out
    }

    private fun mapLedgerEntries(cursor: Cursor): List<LedgerEntry> {
        val out = mutableListOf<LedgerEntry>()
        val idCol = cursor.getColumnIndexOrThrow("id")
        val uuidCol = cursor.getColumnIndexOrThrow("uuid")
        val kindCol = cursor.getColumnIndexOrThrow("kind")
        val directionCol = cursor.getColumnIndexOrThrow("direction")
        val amountCol = cursor.getColumnIndexOrThrow("amount")
        val noteCol = cursor.getColumnIndexOrThrow("note")
        val occurredAtCol = cursor.getColumnIndexOrThrow("occurred_at")
        val orderIdCol = cursor.getColumnIndexOrThrow("order_id")
        val payableIdCol = cursor.getColumnIndexOrThrow("vendor_payable_id")
        while (cursor.moveToNext()) {
            out += LedgerEntry(
                id = cursor.getLong(idCol),
                uuid = if (cursor.isNull(uuidCol)) null else cursor.getString(uuidCol),
                kind = cursor.getString(kindCol) ?: "",
                direction = cursor.getString(directionCol) ?: "",
                amount = round2(if (cursor.isNull(amountCol)) 0.0 else cursor.getDouble(amountCol)),
                note = cursor.getString(noteCol) ?: "",
                occurredAt = if (cursor.isNull(occurredAtCol)) null else cursor.getString(occurredAtCol),
                orderId = if (cursor.isNull(orderIdCol)) null else cursor.getInt(orderIdCol),
                vendorPayableId = if (cursor.isNull(payableIdCol)) null else cursor.getInt(payableIdCol),
            )
        }
        return out
    }

    private fun mapMonthly(cursor: Cursor): List<MonthlyRow> {
        val out = mutableListOf<MonthlyRow>()
        val monthCol = cursor.getColumnIndexOrThrow("month")
        val billedCol = cursor.getColumnIndexOrThrow("billed")
        val settledCol = cursor.getColumnIndexOrThrow("settled")
        val entriesCol = cursor.getColumnIndexOrThrow("entries")
        while (cursor.moveToNext()) {
            out += MonthlyRow(
                month = cursor.getString(monthCol) ?: "",
                billed = round2(cursor.getDouble(billedCol)),
                settled = round2(cursor.getDouble(settledCol)),
                entries = cursor.getInt(entriesCol),
            )
        }
        return out
    }

    private fun mapOpenPayables(cursor: Cursor): List<OpenPayable> {
        val out = mutableListOf<OpenPayable>()
        val idCol = cursor.getColumnIndexOrThrow("id")
        val amountCol = cursor.getColumnIndexOrThrow("amount")
        val settledCol = cursor.getColumnIndexOrThrow("settled")
        while (cursor.moveToNext()) {
            out += OpenPayable(
                id = cursor.getLong(idCol),
                amount = if (cursor.isNull(amountCol)) 0.0 else cursor.getDouble(amountCol),
                settled = cursor.getDouble(settledCol),
            )
        }
        return out
    }

    private fun mapPayableRow(cursor: Cursor): VendorPayableEntity {
        return VendorPayableEntity(
            id = cursor.getLong(cursor.getColumnIndexOrThrow("id")),
            vendorId = cursor.getInt(cursor.getColumnIndexOrThrow("vendor_id")),
            amount = if (cursor.isNull(cursor.getColumnIndexOrThrow("amount"))) 0.0
            else cursor.getDouble(cursor.getColumnIndexOrThrow("amount")),
            dueDate = cursor.getString(cursor.getColumnIndexOrThrow("due_date")),
            status = cursor.getString(cursor.getColumnIndexOrThrow("status")),
            createdAt = cursor.getString(cursor.getColumnIndexOrThrow("created_at")),
            uuid = cursor.getString(cursor.getColumnIndexOrThrow("uuid")),
            shopId = cursor.getInt(cursor.getColumnIndexOrThrow("shop_id")),
            updatedAt = cursor.getString(cursor.getColumnIndexOrThrow("updated_at")),
        )
    }
}
