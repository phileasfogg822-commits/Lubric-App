package app.lubric.desktop.data.catalog

import androidx.room.withTransaction
import app.lubric.desktop.data.db.AccountEntity
import app.lubric.desktop.data.db.BrandEntity
import app.lubric.desktop.data.db.CategoryEntity
import app.lubric.desktop.data.db.ContainerEntity
import app.lubric.desktop.data.db.LubricDatabase
import app.lubric.desktop.data.db.ProductEntity
import app.lubric.desktop.data.db.ServiceEntity
import app.lubric.desktop.data.db.StockLevelEntity
import app.lubric.desktop.data.db.StockMovementEntity
import app.lubric.desktop.data.db.VendorEntity
import java.time.Instant
import java.util.UUID

/**
 * Catalog repository: products, services, master lists (categories, brands,
 * vendors), open containers and payment accounts.
 *
 * Mirrors the web app's ProductPane (`src/modules/catalog/ProductPane.tsx`):
 * the product form's parsing rules, the inline category/brand creation with
 * case-insensitive reuse, and the stock count-correction ledger entry on
 * edit. Categories/brands are local-only until a pull brings them — the live
 * server does not serve them yet, which is expected.
 */
class CatalogRepository(private val db: LubricDatabase) {

    suspend fun products(query: String): List<ProductEntity> =
        if (query.isBlank()) db.productDao().listActive()
        else db.productDao().searchActive(query.trim())

    /**
     * All products (active and hidden), for the Products screen: a hidden
     * product must stay visible so it can be shown again. Filtered in
     * memory because there is no active+search DAO query.
     */
    suspend fun productsAll(query: String): List<ProductEntity> {
        val all = db.productDao().listAll()
        if (query.isBlank()) return all
        val q = query.trim().lowercase()
        return all.filter {
            it.name.lowercase().contains(q) ||
                (it.sku ?: "").lowercase().contains(q) ||
                (it.barcode ?: "").lowercase().contains(q)
        }
    }

    suspend fun services(query: String): List<ServiceEntity> =
        if (query.isBlank()) db.serviceDao().listActive()
        else db.serviceDao().searchActive(query.trim())

    suspend fun productById(id: Long): ProductEntity? = db.productDao().getById(id)

    suspend fun categories(): List<CategoryEntity> = db.categoryDao().listAll()

    suspend fun brands(): List<BrandEntity> = db.brandDao().listAll()

    suspend fun vendors(): List<VendorEntity> = db.vendorDao().listAll()

    suspend fun openContainers(): List<ContainerEntity> = db.containerDao().listOpen()

    suspend fun accounts(): List<AccountEntity> = db.accountDao().listActive()

    suspend fun addCategory(name: String, shopId: Int): CategoryEntity {
        val trimmed = name.trim()
        require(trimmed.isNotBlank()) { "Name required" }
        db.categoryDao().getByNameLower(trimmed)?.let { return it }
        db.categoryDao().upsert(
            CategoryEntity(
                name = trimmed,
                uuid = UUID.randomUUID().toString(),
                shopId = shopId,
                updatedAt = nowIso(),
            ),
        )
        return db.categoryDao().getByNameLower(trimmed)!!
    }

    suspend fun addBrand(name: String, shopId: Int): BrandEntity {
        val trimmed = name.trim()
        require(trimmed.isNotBlank()) { "Name required" }
        db.brandDao().getByNameLower(trimmed)?.let { return it }
        db.brandDao().upsert(
            BrandEntity(
                name = trimmed,
                uuid = UUID.randomUUID().toString(),
                shopId = shopId,
                updatedAt = nowIso(),
            ),
        )
        return db.brandDao().getByNameLower(trimmed)!!
    }

    /**
     * The product form, as typed strings exactly like the web form's state
     * (ProductPane EMPTY). Parsing to numbers happens in [saveProduct],
     * following the web rules; [priceWalking] is null when blank.
     */
    data class ProductForm(
        val name: String,
        val packing: String,
        val brandId: Int?,
        val categoryId: Int?,
        val vendorId: Int?,
        val unit: String,
        val variant: String,
        val offer: String,
        val mfdDate: String,
        val expDate: String,
        val receivedDate: String,
        val stockQty: String,
        val priceReturning: String,
        val priceWalking: String?,
        val priceWholesale: String,
        val wholesaleMinQty: String,
        val lowStockThreshold: String,
    )

    suspend fun saveProduct(form: ProductForm, shopId: Int, existingId: Long? = null): Long {
        val name = form.name.trim()
        require(name.isNotBlank()) { "Name required" }
        val now = nowIso()
        // Web parse: empty strings -> null for variant/packing/dates/offer.
        // The local entity columns are non-null Strings, so "" is the
        // local equivalent of the web's null.
        val packing = form.packing.trim()
        val variant = form.variant.trim()
        val offer = form.offer.trim()
        val mfdDate = form.mfdDate.trim()
        val expDate = form.expDate.trim()
        val receivedDate = form.receivedDate.trim()
        val unit = form.unit.trim().ifEmpty { "piece" }
        val stockQty = form.stockQty.toDoubleOrNull() ?: 0.0
        val lowStockThreshold = form.lowStockThreshold.toDoubleOrNull() ?: 5.0
        val priceReturning = form.priceReturning.toDoubleOrNull() ?: 0.0
        val priceWalking = form.priceWalking?.trim()?.ifEmpty { null }?.toDoubleOrNull()
        val priceWholesale = form.priceWholesale.toDoubleOrNull() ?: 0.0
        val wholesaleMinQty = form.wholesaleMinQty.toDoubleOrNull() ?: 10.0

        if (existingId == null) {
            val uuid = UUID.randomUUID().toString()
            db.productDao().upsert(
                ProductEntity(
                    shopId = shopId,
                    name = name,
                    brandId = form.brandId,
                    categoryId = form.categoryId,
                    vendorId = form.vendorId,
                    packing = packing,
                    unit = unit,
                    variant = variant,
                    mfdDate = mfdDate,
                    expDate = expDate,
                    receivedDate = receivedDate,
                    offer = offer,
                    stockQty = stockQty,
                    lowStockThreshold = lowStockThreshold,
                    priceReturning = priceReturning,
                    priceWalking = priceWalking,
                    priceWholesale = priceWholesale,
                    wholesaleMinQty = wholesaleMinQty,
                    active = true,
                    uuid = uuid,
                    updatedAt = now,
                ),
            )
            return db.productDao().getByUuid(uuid)!!.id
        }

        db.withTransaction {
            val existing = db.productDao().getById(existingId)
                ?: throw IllegalArgumentException("Product not found")
            val prevStock = existing.stockQty ?: 0.0
            val delta = round3(stockQty - prevStock)
            val base = existing.copy(
                name = name,
                brandId = form.brandId,
                categoryId = form.categoryId,
                vendorId = form.vendorId,
                packing = packing,
                unit = unit,
                variant = variant,
                mfdDate = mfdDate,
                expDate = expDate,
                receivedDate = receivedDate,
                offer = offer,
                // Stock is NOT a plain column write on edit: typing a new
                // number is a physical count, posted below as a
                // count_correction movement.
                stockQty = prevStock,
                lowStockThreshold = lowStockThreshold,
                priceReturning = priceReturning,
                priceWalking = priceWalking,
                priceWholesale = priceWholesale,
                wholesaleMinQty = wholesaleMinQty,
                updatedAt = now,
            )
            db.productDao().upsert(base)
            if (delta != 0.0) {
                val warehouseId = db.warehouseDao().defaultId(shopId)?.toInt()
                db.stockMovementDao().upsert(
                    StockMovementEntity(
                        uuid = UUID.randomUUID().toString(),
                        shopId = shopId,
                        itemId = existingId.toInt(),
                        kind = "count_correction",
                        qty = delta,
                        qtyAfter = stockQty,
                        refTable = "products",
                        refId = existingId.toInt(),
                        warehouseId = warehouseId,
                        note = "Stock counted at $stockQty, books said $prevStock",
                        occurredAt = now,
                    ),
                )
                db.productDao().upsert(base.copy(stockQty = stockQty))
                // Per-warehouse cache, same pattern as the sale: no default
                // warehouse -> skip it.
                if (warehouseId != null) {
                    val level = db.stockLevelDao()
                        .getByWarehouseAndProduct(warehouseId, existingId.toInt())
                    if (level != null) {
                        db.stockLevelDao().upsert(
                            level.copy(qty = (level.qty ?: 0.0) + delta, updatedAt = now),
                        )
                    } else {
                        db.stockLevelDao().upsert(
                            StockLevelEntity(
                                uuid = UUID.randomUUID().toString(),
                                shopId = shopId,
                                warehouseId = warehouseId,
                                productId = existingId.toInt(),
                                qty = delta,
                                updatedAt = now,
                            ),
                        )
                    }
                }
            }
        }
        return existingId
    }

    suspend fun setProductActive(id: Long, active: Boolean) {
        val existing = db.productDao().getById(id)
            ?: throw IllegalArgumentException("Product not found")
        db.productDao().upsert(existing.copy(active = active, updatedAt = nowIso()))
    }

    private fun nowIso(): String = Instant.now().toString()

    private fun round3(x: Double): Double = Math.round(x * 1000.0) / 1000.0
}
