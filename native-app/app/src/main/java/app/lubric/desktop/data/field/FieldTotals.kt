package app.lubric.desktop.data.field

import app.lubric.desktop.data.db.CashMovementEntity
import app.lubric.desktop.data.pricing.round2

/**
 * Pure field-activity helpers, mirroring the web FieldActivity page
 * (`src/modules/field/FieldActivity.tsx`) and the server posting rule
 * (survey §5.4). No Android or Room imports beyond the entity type, so
 * unit tests run on the JVM.
 */

/**
 * Summary totals over a list of cash movements (web `field_totals` query):
 * collected, handed over, adjusted, row count, and still-in-hand
 * (collected − handed over). An "expense" movement counts in none of the
 * three buckets — the web totals query sums only collection / handover /
 * adjustment.
 */
data class FieldTotals(
    val collected: Double,
    val handedOver: Double,
    val adjusted: Double,
    val rows: Int,
    val inHand: Double,
)

fun fieldTotals(movements: List<CashMovementEntity>): FieldTotals {
    var collected = 0.0
    var handedOver = 0.0
    var adjusted = 0.0
    for (movement in movements) {
        val amount = round2(movement.amount ?: 0.0)
        when (movement.kind) {
            "collection" -> collected += amount
            "handover" -> handedOver += amount
            "adjustment" -> adjusted += amount
        }
    }
    return FieldTotals(
        collected = round2(collected),
        handedOver = round2(handedOver),
        adjusted = round2(adjusted),
        rows = movements.size,
        inHand = round2(collected - handedOver),
    )
}

/**
 * A collection is "linked" when the server matched it to a customer
 * (survey §5.4: an unmatched customer leaves the money banked but the
 * party link off, shown as unlinked in Field Activity).
 */
fun isLinked(movement: CashMovementEntity): Boolean = movement.customerId != null

/**
 * A movement is "posted" once the server claimed it (`posted_at` set) and
 * wrote its party-ledger / account rows (survey §5.4). Null `posted_at`
 * means it arrived on the device but has not been posted yet.
 */
fun isPosted(movement: CashMovementEntity): Boolean = !movement.postedAt.isNullOrBlank()

/** Display label for a cash-movement kind (web `KIND_LABEL`). */
fun cashMovementKindLabel(kind: String): String = when (kind) {
    "collection" -> "Collected"
    "handover" -> "Handed over"
    "adjustment" -> "Adjustment"
    else -> kind
}
