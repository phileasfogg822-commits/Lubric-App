package app.lubric.desktop

import app.lubric.desktop.data.db.PriceListItemEntity
import app.lubric.desktop.data.db.ProductEntity
import app.lubric.desktop.data.pricing.EMPTY_PRICE_CONTEXT
import app.lubric.desktop.data.pricing.PriceContext
import app.lubric.desktop.data.pricing.bestFromList
import app.lubric.desktop.data.pricing.effectiveUnitPrice
import app.lubric.desktop.data.pricing.fromTiers
import app.lubric.desktop.data.pricing.leftoverLitres
import app.lubric.desktop.data.pricing.packLitres
import app.lubric.desktop.data.pricing.resolvePrice
import app.lubric.desktop.data.pricing.round2
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PricingTest {

    private fun product(
        id: Long = 1,
        priceWalking: Double? = null,
        priceWholesale: Double? = 0.0,
        wholesaleMinQty: Double? = 10.0,
        priceReturning: Double? = 0.0,
    ) = ProductEntity(
        id = id,
        name = "Engine Oil 4L",
        packing = "4L",
        priceWalking = priceWalking,
        priceWholesale = priceWholesale,
        wholesaleMinQty = wholesaleMinQty,
        priceReturning = priceReturning,
    )

    private fun listItem(
        listId: Int = 1,
        productId: Int = 1,
        price: Double? = 4000.0,
        minQty: Double? = 0.0,
    ) = PriceListItemEntity(priceListId = listId, productId = productId, price = price, minQty = minQty)

    // -- round2 -----------------------------------------------------------

    @Test
    fun `round2 rounds to two decimals`() {
        assertEquals(1.23, round2(1.234), 0.0)
        assertEquals(1.24, round2(1.235), 0.0)
        assertEquals(0.13, round2(0.125), 0.0)
        assertEquals(4000.0, round2(4000.0), 0.0)
    }

    // -- packLitres -------------------------------------------------------

    @Test
    fun `packLitres parses litres and millilitres`() {
        assertEquals(4.0, packLitres("4L"), 0.0)
        assertEquals(0.5, packLitres("500ml"), 0.0)
        assertEquals(0.25, packLitres("250ML"), 0.0)
        assertEquals(4.5, packLitres("4.5L"), 0.0)
        assertEquals(4.0, packLitres("4"), 0.0)
    }

    @Test
    fun `packLitres returns 0 for ranges, units without volume and blanks`() {
        assertEquals(0.0, packLitres("-4L"), 0.0)
        assertEquals(0.0, packLitres(""), 0.0)
        assertEquals(0.0, packLitres("0L"), 0.0)
        assertEquals(0.0, packLitres("abc"), 0.0)
    }

    @Test
    fun `packLitres treats non-volume units as litres per web behaviour`() {
        assertEquals(1.0, packLitres("1kg"), 0.0)
    }

    // -- leftoverLitres ---------------------------------------------------

    @Test
    fun `leftoverLitres is pack minus capacity in whole millilitres`() {
        assertEquals(0.5, leftoverLitres(4.0, 3.5), 0.0)
        assertEquals(0.667, leftoverLitres(4.0, 3.333), 0.0)
    }

    @Test
    fun `leftoverLitres is 0 when nothing is left`() {
        assertEquals(0.0, leftoverLitres(4.0, 4.0), 0.0)
        assertEquals(0.0, leftoverLitres(4.0, 5.0), 0.0)
        assertEquals(0.0, leftoverLitres(4.0, 0.0), 0.0)
        assertEquals(0.0, leftoverLitres(0.0, 3.5), 0.0)
    }

    // -- effectiveUnitPrice -----------------------------------------------

    @Test
    fun `effectiveUnitPrice pro-rates only when billing by capacity`() {
        assertEquals(3500.0, effectiveUnitPrice(4000.0, 4.0, 3.5, true), 0.0)
        assertEquals(4000.0, effectiveUnitPrice(4000.0, 4.0, 3.5, false), 0.0)
    }

    @Test
    fun `effectiveUnitPrice charges full price at or beyond the pack`() {
        assertEquals(4000.0, effectiveUnitPrice(4000.0, 4.0, 4.0, true), 0.0)
        assertEquals(4000.0, effectiveUnitPrice(4000.0, 4.0, 0.0, true), 0.0)
        assertEquals(4000.0, effectiveUnitPrice(4000.0, 0.0, 3.5, true), 0.0)
    }

    // -- fromTiers --------------------------------------------------------

    @Test
    fun `fromTiers walking takes priceWalking when set`() {
        assertEquals(4500.0, fromTiers(product(priceWalking = 4500.0, priceReturning = 4000.0), "walking", 1.0)!!, 0.0)
    }

    @Test
    fun `fromTiers walking with a 0 walking price still takes it`() {
        assertEquals(0.0, fromTiers(product(priceWalking = 0.0, priceReturning = 4000.0), "walking", 1.0)!!, 0.0)
    }

    @Test
    fun `fromTiers walking falls back to returning when walking is null`() {
        assertEquals(4000.0, fromTiers(product(priceWalking = null, priceReturning = 4000.0), "walking", 1.0)!!, 0.0)
    }

    @Test
    fun `fromTiers wholesale applies at or above the minimum qty`() {
        val p = product(priceWholesale = 3600.0, wholesaleMinQty = 10.0, priceReturning = 4000.0)
        assertEquals(3600.0, fromTiers(p, "wholesale", 10.0)!!, 0.0)
        assertEquals(3600.0, fromTiers(p, "wholesale", 25.0)!!, 0.0)
    }

    @Test
    fun `fromTiers wholesale falls back below the minimum qty`() {
        val p = product(priceWholesale = 3600.0, wholesaleMinQty = 10.0, priceReturning = 4000.0)
        assertEquals(4000.0, fromTiers(p, "wholesale", 9.0)!!, 0.0)
    }

    @Test
    fun `fromTiers wholesale falls back when the wholesale price is zero`() {
        val p = product(priceWholesale = 0.0, wholesaleMinQty = 10.0, priceReturning = 4000.0)
        assertEquals(4000.0, fromTiers(p, "wholesale", 25.0)!!, 0.0)
    }

    @Test
    fun `fromTiers returning takes priceReturning`() {
        assertEquals(4000.0, fromTiers(product(priceReturning = 4000.0), "returning", 1.0)!!, 0.0)
    }

    @Test
    fun `fromTiers returns null when every column is null`() {
        val p = product(priceWalking = null, priceWholesale = null, priceReturning = null)
        assertNull(fromTiers(p, "returning", 1.0))
        assertNull(fromTiers(p, "walking", 1.0))
        assertNull(fromTiers(p, "wholesale", 99.0))
    }

    // -- bestFromList -----------------------------------------------------

    @Test
    fun `bestFromList takes the highest min_qty reached`() {
        val items = listOf(
            listItem(price = 4000.0, minQty = 0.0),
            listItem(price = 3800.0, minQty = 5.0),
            listItem(price = 3500.0, minQty = 10.0),
        )
        assertEquals(4000.0, bestFromList(items, 1, 3.0)!!, 0.0)
        assertEquals(3800.0, bestFromList(items, 1, 7.0)!!, 0.0)
        assertEquals(3500.0, bestFromList(items, 1, 10.0)!!, 0.0)
    }

    @Test
    fun `bestFromList skips other products, null prices and unreached mins`() {
        val items = listOf(
            listItem(productId = 2, price = 100.0, minQty = 0.0),
            listItem(price = null, minQty = 0.0),
            listItem(price = 3800.0, minQty = 5.0),
        )
        assertNull(bestFromList(items, 1, 3.0))
    }

    @Test
    fun `bestFromList keeps the first row on a min_qty tie`() {
        val items = listOf(
            listItem(price = 3800.0, minQty = 5.0),
            listItem(price = 3700.0, minQty = 5.0),
        )
        assertEquals(3800.0, bestFromList(items, 1, 5.0)!!, 0.0)
    }

    // -- resolvePrice -----------------------------------------------------

    private fun pricedProduct() = product(
        priceWalking = 4500.0,
        priceWholesale = 3600.0,
        wholesaleMinQty = 10.0,
        priceReturning = 4000.0,
    )

    private fun fullContext() = PriceContext(
        priceListId = 1,
        listItems = listOf(listItem(listId = 1, price = 3200.0, minQty = 0.0)),
        groupListItems = listOf(listItem(listId = 2, price = 3400.0, minQty = 0.0)),
        partyPrices = mapOf(1 to 3000.0),
        groupTier = "wholesale",
        group = null,
    )

    @Test
    fun `resolvePrice party price beats everything`() {
        assertEquals(3000.0 to "party", resolvePrice(pricedProduct(), "walking", 10.0, fullContext()))
    }

    @Test
    fun `resolvePrice assigned list beats group list and tiers`() {
        val ctx = fullContext().copy(partyPrices = emptyMap())
        assertEquals(3200.0 to "assigned_list", resolvePrice(pricedProduct(), "walking", 10.0, ctx))
    }

    @Test
    fun `resolvePrice group list beats group tier and tier columns`() {
        val ctx = fullContext().copy(partyPrices = emptyMap(), listItems = emptyList())
        assertEquals(3400.0 to "group_list", resolvePrice(pricedProduct(), "walking", 10.0, ctx))
    }

    @Test
    fun `resolvePrice group tier beats tier columns`() {
        val ctx = fullContext().copy(
            partyPrices = emptyMap(),
            listItems = emptyList(),
            groupListItems = emptyList(),
        )
        assertEquals(3600.0 to "group_tier", resolvePrice(pricedProduct(), "walking", 10.0, ctx))
    }

    @Test
    fun `resolvePrice tier columns are the fallback before none`() {
        assertEquals(4500.0 to "tier", resolvePrice(pricedProduct(), "walking", 10.0, EMPTY_PRICE_CONTEXT))
    }

    @Test
    fun `resolvePrice returns zero none when no price exists`() {
        val bare = product(priceWalking = null, priceWholesale = null, priceReturning = null)
        assertEquals(0.0 to "none", resolvePrice(bare, "walking", 1.0, EMPTY_PRICE_CONTEXT))
    }
}
