package app.lubric.desktop.data.vendors

import app.lubric.desktop.data.db.LubricDatabase
import app.lubric.desktop.data.db.VendorEntity
import app.lubric.desktop.data.db.VendorPayableEntity
import java.time.Instant
import java.util.UUID

/**
 * Vendor repository: list/search, detail aggregates, save and soft delete.
 *
 * Mirrors the web Vendors screen (`src/modules/vendors/Vendors.tsx`):
 * form fields are name / contact / phone; a new vendor starts with
 * `payable_balance` 0; the list shows the derived payable balance when it
 * is positive. The web list SQL has no `deleted_at` filter; this package
 * excludes soft-deleted rows from lists so a delete actually hides the
 * row (see [VendorQueriesDao]).
 *
 * Reads go through the existing [app.lubric.desktop.data.db.VendorDao]
 * plus [VendorQueriesDao] (registered on [LubricDatabase]). All writes go
 * through DAO upserts, so the existing outbox triggers queue them for
 * sync; no `sync_outbox` row is ever written by hand.
 */
class VendorRepository(private val db: LubricDatabase) {

    data class VendorForm(
        val name: String,
        val contact: String,
        val phone: String,
    )

    /** A vendor with its payables and its ledger-derived balance. */
    data class VendorDetail(
        val vendor: VendorEntity,
        val payables: List<VendorPayableEntity>,
        /** SUM(debit) - SUM(credit) over party_ledger; positive = we owe them. */
        val ledgerBalance: Double,
    )

    /** Vendors matching [query] in name or phone; blank query lists all. */
    suspend fun vendors(query: String): List<VendorEntity> {
        val all = db.vendorDao().listAll().filter { it.deletedAt == null }
        val q = query.trim()
        if (q.isBlank()) return all
        return all.filter {
            it.name.contains(q, ignoreCase = true) ||
                it.phone.contains(q, ignoreCase = true)
        }
    }

    suspend fun vendorById(id: Long): VendorEntity? = db.vendorDao().getById(id)

    suspend fun vendorDetail(id: Long): VendorDetail {
        val vendor = db.vendorDao().getById(id)
            ?: throw IllegalArgumentException("Vendor not found")
        val payables = db.vendorQueriesDao().payablesByVendor(id)
        val balance = db.vendorQueriesDao().vendorBalance(id)
        return VendorDetail(vendor, payables, balance)
    }

    suspend fun saveVendor(
        form: VendorForm,
        shopId: Int,
        existingId: Long? = null,
    ): Long {
        val name = form.name.trim()
        require(name.isNotBlank()) { "Name required" }
        val now = Instant.now().toString()
        if (existingId == null) {
            val uuid = UUID.randomUUID().toString()
            db.vendorDao().upsert(
                VendorEntity(
                    name = name,
                    contact = form.contact.trim(),
                    phone = form.phone.trim(),
                    payableBalance = 0.0,
                    uuid = uuid,
                    shopId = shopId,
                    updatedAt = now,
                ),
            )
            return db.vendorDao().getByUuid(uuid)!!.id
        }
        val existing = db.vendorDao().getById(existingId)
            ?: throw IllegalArgumentException("Vendor not found")
        db.vendorDao().upsert(
            existing.copy(
                name = name,
                contact = form.contact.trim(),
                phone = form.phone.trim(),
                updatedAt = now,
            ),
        )
        return existingId
    }

    /** Soft delete: stamps `deleted_at`; the row (and its history) stays. */
    suspend fun softDeleteVendor(id: Long) {
        val existing = db.vendorDao().getById(id)
            ?: throw IllegalArgumentException("Vendor not found")
        val now = Instant.now().toString()
        db.vendorDao().upsert(
            existing.copy(deletedAt = now, updatedAt = now),
        )
    }
}
