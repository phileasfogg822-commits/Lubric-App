package app.lubric.desktop.data.pricing

import app.lubric.desktop.data.db.PriceListItemEntity
import app.lubric.desktop.data.db.PriceMemoryRow
import app.lubric.desktop.data.db.ProductEntity
import kotlin.math.abs

/**
 * Pure pricing helpers mirroring the web app (`src/lib/units.ts`,
 * `usePriceContext.ts`, `priceMemory.ts`). No Android or Room imports —
 * only entity types cross the boundary, so unit tests run on the JVM.
 *
 * Rounding: the web uses JS `Math.round` (ties round UP), so this file
 * uses `java.lang.Math.round` (also ties-up) rather than Kotlin's
 * [kotlin.math.round] (ties-to-even), which would differ by 0.01 on
 * exact .5-after-scaling cases (e.g. 3999 prorated at 3.5/4L is
 * 3499.125: web 3499.13).
 */

/** Web: `Math.round((Number(n) + Number.EPSILON) * 100) / 100`. */
fun round2(n: Double): Double =
    java.lang.Math.round((n + 2.220446049250313e-16) * 100).toDouble() / 100

/**
 * Web `packLitres` (`src/lib/units.ts`): parse the digits/dots out of the
 * packing string; a "-" anywhere means "not a volume" (0.0); "ml" means
 * millilitres, anything else is litres.
 */
fun packLitres(packing: String): Double {
    val raw = packing.trim().lowercase()
    if ("-" in raw) return 0.0
    val n = raw.filter { it.isDigit() || it == '.' }.toDoubleOrNull() ?: return 0.0
    if (!n.isFinite() || n <= 0.0) return 0.0
    return if ("ml" in raw) n / 1000 else n
}

/** Litres left in the pack after pouring [capacity] out of it. */
fun leftoverLitres(packLitres: Double, capacity: Double): Double {
    if (packLitres <= 0.0 || capacity <= 0.0 || capacity >= packLitres) return 0.0
    return java.lang.Math.round((packLitres - capacity) * 1000).toDouble() / 1000.0
}

/**
 * Pro-rated unit price when billing by capacity: only when [billByCapacity]
 * is set and the capacity is a strict part of the pack.
 */
fun effectiveUnitPrice(
    tierPrice: Double,
    packLitres: Double,
    capacity: Double,
    billByCapacity: Boolean,
): Double {
    if (billByCapacity && packLitres > 0.0 && capacity > 0.0 && capacity < packLitres) {
        return round2(tierPrice * (capacity / packLitres))
    }
    return tierPrice
}

/**
 * Tier-column price, web rules: "walking" takes `price_walking` when set
 * (even 0.0); "wholesale" takes `price_wholesale` only when it is
 * non-null, non-zero, and [qty] reaches `wholesale_min_qty`; anything
 * else — including "returning", which has no branch of its own — falls
 * through to `price_returning`.
 */
fun fromTiers(product: ProductEntity, tier: String, qty: Double): Double? {
    if (tier == "walking" && product.priceWalking != null) return product.priceWalking
    if (tier == "wholesale" && product.priceWholesale != null && product.priceWholesale != 0.0 &&
        qty >= (product.wholesaleMinQty ?: 0.0)
    ) {
        return product.priceWholesale
    }
    return product.priceReturning
}

/**
 * Best price-list row for [productId] at [qty]: the row with the highest
 * `min_qty` reached (ties keep the first row); rows for other products,
 * rows with a null price, and rows whose `min_qty` exceeds [qty] are
 * skipped.
 */
fun bestFromList(items: List<PriceListItemEntity>, productId: Int, qty: Double): Double? {
    var bestPrice: Double? = null
    var bestMinQty = Double.NEGATIVE_INFINITY
    for (item in items) {
        if (item.productId != productId || item.price == null) continue
        val minQty = item.minQty ?: 0.0
        if (qty < minQty) continue
        if (minQty > bestMinQty) {
            bestMinQty = minQty
            bestPrice = item.price
        }
    }
    return bestPrice
}

/**
 * Price precedence (web `usePriceContext.ts`): party price, assigned
 * price list, group price list, group tier, tier columns, then none.
 * `product.id` is a Long; party-price keys are Int product ids.
 */
fun resolvePrice(
    product: ProductEntity,
    customerType: String,
    qty: Double,
    ctx: PriceContext,
): Pair<Double, String> {
    val productId = product.id.toInt()
    ctx.partyPrices[productId]?.let { return it to "party" }
    bestFromList(ctx.listItems, productId, qty)?.let { return it to "assigned_list" }
    bestFromList(ctx.groupListItems, productId, qty)?.let { return it to "group_list" }
    if (ctx.groupTier != null) {
        fromTiers(product, ctx.groupTier, qty)?.let { return it to "group_tier" }
    }
    fromTiers(product, customerType, qty)?.let { return it to "tier" }
    return 0.0 to "none"
}

/**
 * Pure price-memory builder (web `priceMemory.ts`), so tests can call it
 * without Room. Rows are sorted newest first (`created_at` DESC, ties by
 * `order_id` DESC); litres come from the row's capacity, falling back to
 * the product's pack size from [packs] (0.0 when the product is unknown);
 * when [wantedLitres] has a positive target for a product, only rows
 * within 0.05 L of it are kept; at most [limit] entries per product.
 */
fun buildPriceMemory(
    rows: List<PriceMemoryRow>,
    packs: Map<Int, Double>,
    wantedLitres: Map<Int, Double>,
    limit: Int,
): Map<Int, List<PriceMemoryEntry>> {
    val sorted = rows.sortedWith(
        compareByDescending<PriceMemoryRow> { it.createdAt ?: "" }
            .thenByDescending { it.orderId ?: Int.MIN_VALUE },
    )
    val out = linkedMapOf<Int, MutableList<PriceMemoryEntry>>()
    for (row in sorted) {
        val productId = row.refId ?: continue
        val list = out.getOrPut(productId) { mutableListOf() }
        if (list.size >= limit) continue
        val capacity = row.capacity ?: 0.0
        val litres = if (capacity > 0.0) capacity else (packs[productId] ?: 0.0)
        val wanted = wantedLitres[productId]
        if (wanted != null && wanted > 0.0 && abs(litres - wanted) >= 0.05) continue
        list += PriceMemoryEntry(
            productId = productId,
            litres = litres,
            unitPrice = row.unitPrice ?: 0.0,
            qty = row.qty ?: 0.0,
            prorated = row.billedByCapacity,
            date = row.createdAt,
        )
    }
    return out.filterValues { it.isNotEmpty() }
}
