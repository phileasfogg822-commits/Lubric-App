package app.lubric.desktop.ui.reports

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.lubric.desktop.data.reports.Pnl
import app.lubric.desktop.data.reports.ReportPeriod
import app.lubric.desktop.data.reports.ReportRepository
import app.lubric.desktop.data.reports.pct
import app.lubric.desktop.data.reports.periodRange
import app.lubric.desktop.ui.common.ErrorText
import app.lubric.desktop.ui.common.LubricScreen
import app.lubric.desktop.ui.sale.formatMoney
import java.time.LocalDate
import kotlinx.coroutines.launch

/** Nav route string (coordinator wires it in Nav.kt). */
const val PROFIT_ROUTE = "profit"

class ProfitLossViewModel(
    private val repository: ReportRepository,
) : ViewModel() {

    var period by mutableStateOf(ReportPeriod.ALL)
        private set
    var customFrom by mutableStateOf("")
    var customTo by mutableStateOf("")
    var pnl by mutableStateOf<Pnl?>(null)
        private set
    var rangeLabel by mutableStateOf("")
        private set
    var error by mutableStateOf<String?>(null)
        private set
    var busy by mutableStateOf(false)
        private set

    fun selectPeriod(period: ReportPeriod, shopId: Int) {
        this.period = period
        if (period != ReportPeriod.CUSTOM) refresh(shopId)
    }

    fun applyCustom(shopId: Int) {
        if (customFrom.isBlank() || customTo.isBlank()) {
            error = "Enter both dates (YYYY-MM-DD)"
            return
        }
        try {
            val from = LocalDate.parse(customFrom.trim())
            val to = LocalDate.parse(customTo.trim())
            if (to.isBefore(from)) {
                error = "End date is before start date"
                return
            }
        } catch (_: Exception) {
            error = "Dates must be YYYY-MM-DD"
            return
        }
        refresh(shopId)
    }

    fun refresh(shopId: Int) {
        if (busy) return
        busy = true
        error = null
        viewModelScope.launch {
            try {
                val now = LocalDate.now()
                val (from, toExclusive) = periodRange(
                    period, now,
                    customFrom.trim().ifBlank { null },
                    customTo.trim().ifBlank { null },
                )
                val toInclusive = try {
                    LocalDate.parse(toExclusive).minusDays(1).toString()
                } catch (_: Exception) {
                    toExclusive
                }
                rangeLabel = "$from → $toInclusive"
                pnl = repository.pnl(period, shopId, customFrom.trim().ifBlank { null }, customTo.trim().ifBlank { null }, now)
            } catch (e: Exception) {
                error = e.message ?: "Could not load profit & loss"
            } finally {
                busy = false
            }
        }
    }
}

@Composable
fun ProfitLossScreen(
    viewModel: ProfitLossViewModel,
    shopId: Int,
    onBack: () -> Unit,
) {
    LaunchedEffect(shopId) { viewModel.refresh(shopId) }
    LubricScreen(title = "Profit & Loss", onBack = onBack) {
        Spacer(Modifier.height(12.dp))
        PeriodChips(
            periods = PNL_PERIODS,
            selected = viewModel.period,
            onSelect = { viewModel.selectPeriod(it, shopId) },
        )
        if (viewModel.period == ReportPeriod.CUSTOM) {
            Spacer(Modifier.height(8.dp))
            CustomRangeInputs(
                from = viewModel.customFrom,
                to = viewModel.customTo,
                onFrom = { viewModel.customFrom = it },
                onTo = { viewModel.customTo = it },
                onApply = { viewModel.applyCustom(shopId) },
            )
        }
        Spacer(Modifier.height(8.dp))
        if (viewModel.rangeLabel.isNotBlank()) {
            Text(viewModel.rangeLabel, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        ErrorText(viewModel.error)
        val p = viewModel.pnl
        if (p == null) {
            Spacer(Modifier.height(16.dp))
            Text(
                if (viewModel.busy) "Loading…" else "No figures yet",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        } else {
            Spacer(Modifier.height(12.dp))
            // Headline cards — same four as the web ProfitLoss page.
            TotalCard("Net Profit", formatMoney(p.netProfit))
            TotalCard("Net Profit Margin", pct(p.netMargin))
            TotalCard("Net Sales", formatMoney(p.netSales))
            TotalCard("Gross Profit", formatMoney(p.grossProfit))
            TotalCard("Gross Margin", pct(p.grossMargin))
            TotalCard("Operating Expenses", formatMoney(p.shopExpenses))

            Spacer(Modifier.height(12.dp))
            Text("Income Statement", style = MaterialTheme.typography.titleMedium)
            // Same lines, same order as the web income statement.
            StatementCard(
                listOf(
                    "Total Sales" to formatMoney(p.totalSales),
                    "Discounts Given" to formatMoney(p.discounts),
                    "Refunds (cancelled / void bills)" to formatMoney(p.refunds),
                    "Sales After Discount" to formatMoney(p.totalSales - p.discounts - p.refunds),
                    "Net Sales" to formatMoney(p.netSales),
                    "Product Sales" to formatMoney(p.productSales),
                    "Product Cost" to formatMoney(p.productCost),
                    "Service Sales" to formatMoney(p.serviceSales),
                    "Service Cost" to formatMoney(p.serviceCost),
                    "Gross Profit" to formatMoney(p.grossProfit),
                    "Shop Expenses" to formatMoney(p.shopExpenses),
                    "Net Profit" to formatMoney(p.netProfit),
                    // Memo only: purchases are stock, not a P&L cost — the
                    // web P&L never subtracts them (see Pnl.purchasesTotal).
                    "Purchases in period (received, memo)" to formatMoney(p.purchasesTotal),
                ),
            )
        }
        Spacer(Modifier.height(16.dp))
    }
}

/** One card holding the income-statement lines. */
@Composable
private fun StatementCard(lines: List<Pair<String, String>>) {
    Card(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
        Column(Modifier.padding(12.dp)) {
            for ((label, value) in lines) {
                Text(
                    "$label: $value",
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.padding(vertical = 2.dp),
                )
            }
        }
    }
}
