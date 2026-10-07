package com.lubrcapp.lubrcapp.domain.reporting

/**
 * Generic report request/result types shared by report modules.
 */
data class ReportRequest(
    val type: ReportType,
    val businessId: String,
    val dateFrom: Long? = null,
    val dateTo: Long? = null,
    val filters: Map<String, String> = emptyMap(),
)

data class ReportResult(
    val type: ReportType,
    val generatedAt: Long = 0L,
    val rows: List<ReportRow> = emptyList(),
    val summary: Map<String, Double> = emptyMap(),
)

data class ReportRow(
    val labels: List<String> = emptyList(),
    val values: List<Double> = emptyList(),
)

enum class ReportType {
    SALES_SUMMARY,
    PURCHASE_SUMMARY,
    PROFIT_LOSS,
    BALANCE_SHEET,
    TAX_SUMMARY,
    INVENTORY_VALUATION,
    PARTY_STATEMENT,
    CASH_FLOW,
    TOP_ITEMS,
    TOP_PARTIES,
}
