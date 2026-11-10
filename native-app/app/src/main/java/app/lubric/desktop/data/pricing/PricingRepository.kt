package app.lubric.desktop.data.pricing

import app.lubric.desktop.data.db.CustomerGroupEntity
import app.lubric.desktop.data.db.LubricDatabase
import app.lubric.desktop.data.db.PriceListItemEntity

/**
 * Everything [resolvePrice] needs for one customer, loaded once per sale
 * (web `usePriceContext.ts`).
 */
data class PriceContext(
    val priceListId: Int?,
    val listItems: List<PriceListItemEntity>,
    val groupListItems: List<PriceListItemEntity>,
    val partyPrices: Map<Int, Double>,
    val groupTier: String?,
    val group: CustomerGroupEntity?,
)

/**
 * Single shared object for walk-ins (null customer) — never create a
 * fresh one per call.
 */
val EMPTY_PRICE_CONTEXT = PriceContext(null, emptyList(), emptyList(), emptyMap(), null, null)

data class PriceMemoryEntry(
    val productId: Int,
    val litres: Double,
    val unitPrice: Double,
    val qty: Double,
    val prorated: Boolean,
    val date: String?,
)

class PricingRepository(private val db: LubricDatabase) {

    /**
     * The web's 5 price-context queries: (1) the customer's assigned price
     * list, (2) that list's items, (3) the customer's per-product party
     * prices, (4) the customer's group (active only) and its tier,
     * (5) the group's price-list items.
     */
    suspend fun loadPriceContext(customerId: Int?): PriceContext {
        if (customerId == null) return EMPTY_PRICE_CONTEXT
        val listId = db.partyPriceListDao().listIdForParty("customer", customerId)
        val listItems =
            if (listId != null) db.priceListItemDao().itemsForList(listId) else emptyList()
        val partyPrices = db.partyPriceDao().listForParty("customer", customerId)
            .mapNotNull { row ->
                val productId = row.productId
                val price = row.price
                if (productId == null || price == null) null else productId to price
            }
            .toMap()
        val group = db.customerDao().getById(customerId.toLong())?.groupId
            ?.let { db.customerGroupDao().getById(it.toLong()) }
            ?.takeIf { it.active }
        val groupTier = group?.priceTier
        val groupListItems =
            if (group?.priceListId != null) {
                db.priceListItemDao().itemsForList(group.priceListId)
            } else {
                emptyList()
            }
        return PriceContext(listId, listItems, groupListItems, partyPrices, groupTier, group)
    }

    /**
     * Last prices paid for [productIds] by [customerId], newest first
     * (see [buildPriceMemory]). Products whose row is missing get pack
     * 0.0, so their rows fall back to capacity only.
     */
    suspend fun priceMemory(
        customerId: Int,
        productIds: List<Int>,
        wantedLitres: Map<Int, Double> = emptyMap(),
        limit: Int = 2,
    ): Map<Int, List<PriceMemoryEntry>> {
        if (productIds.isEmpty()) return emptyMap()
        val rows = db.orderItemDao().priceMemoryRows(customerId, productIds)
        val packs = productIds.associateWith { id ->
            db.productDao().getById(id.toLong())?.let { packLitres(it.packing) } ?: 0.0
        }
        return buildPriceMemory(rows, packs, wantedLitres, limit)
    }
}
