package app.lubric.desktop.ui.reports

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.lubric.desktop.data.reports.ReportPeriod
import app.lubric.desktop.data.reports.ReportRepository
import app.lubric.desktop.data.reports.ReportTotals
import app.lubric.desktop.data.reports.periodRange
import app.lubric.desktop.ui.common.ErrorText
import app.lubric.desktop.ui.common.LubricScreen
import app.lubric.desktop.ui.sale.formatMoney
import java.time.LocalDate
import kotlinx.coroutines.launch

/** Nav route string (coordinator wires it in Nav.kt). */
const val REPORTS_ROUTE = "reports"

/**
 * Period chips shown on the Reports screen. The web P&L chips are
 * Today / This Week / This Month / This Year / All Time / Custom
 * (`pnl.ts` PERIODS); Reports adds Last 30 Days, which is the Reports
 * SummaryTab default range on the web.
 */
val REPORT_PERIODS: List<ReportPeriod> = listOf(
    ReportPeriod.TODAY,
    ReportPeriod.WEEK,
    ReportPeriod.MONTH,
    ReportPeriod.LAST_30_DAYS,
    ReportPeriod.YEAR,
    ReportPeriod.ALL,
    ReportPeriod.CUSTOM,
)

/** The web P&L chips only (no Last 30 Days — `pnl.ts` has no such preset). */
val PNL_PERIODS: List<ReportPeriod> = listOf(
    ReportPeriod.TODAY,
    ReportPeriod.WEEK,
    ReportPeriod.MONTH,
    ReportPeriod.YEAR,
    ReportPeriod.ALL,
    ReportPeriod.CUSTOM,
)

class ReportsViewModel(
    private val repository: ReportRepository,
) : ViewModel() {

    var period by mutableStateOf(ReportPeriod.LAST_30_DAYS)
        private set
    var customFrom by mutableStateOf("")
    var customTo by mutableStateOf("")
    var totals by mutableStateOf<ReportTotals?>(null)
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
                // The DAO's `to` is exclusive; show the web's inclusive end.
                val toInclusive = try {
                    LocalDate.parse(toExclusive).minusDays(1).toString()
                } catch (_: Exception) {
                    toExclusive
                }
                rangeLabel = "$from → $toInclusive"
                totals = repository.report(period, shopId, customFrom.trim().ifBlank { null }, customTo.trim().ifBlank { null }, now)
            } catch (e: Exception) {
                error = e.message ?: "Could not load report"
            } finally {
                busy = false
            }
        }
    }
}

@Composable
fun ReportsScreen(
    viewModel: ReportsViewModel,
    shopId: Int,
    onBack: () -> Unit,
) {
    LaunchedEffect(shopId) { viewModel.refresh(shopId) }
    LubricScreen(title = "Reports", onBack = onBack) {
        Spacer(Modifier.height(12.dp))
        PeriodChips(
            periods = REPORT_PERIODS,
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
        val t = viewModel.totals
        if (t == null) {
            Spacer(Modifier.height(16.dp))
            Text(
                if (viewModel.busy) "Loading…" else "No report yet",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        } else {
            Spacer(Modifier.height(12.dp))
            // Same cards as the web SummaryTab totals, plus the purchases
            // and open-payables figures the web shows on its vendor views.
            TotalCard("Revenue (completed bills)", formatMoney(t.revenue))
            TotalCard("Bills", t.bills.toString())
            TotalCard("Collected", formatMoney(t.collected))
            TotalCard("Remaining (credit)", formatMoney(t.remaining))
            TotalCard("Expenses", formatMoney(t.expenses))
            TotalCard("Purchases (received)", formatMoney(t.purchases))
            TotalCard(
                "Open payables",
                formatMoney(t.openPayables) + " (${t.openPayableCount})",
            )
            TotalCard("Profit (revenue − expenses)", formatMoney(t.profit))
        }
        Spacer(Modifier.height(16.dp))
    }
}

/** One full-width totals card. */
@Composable
fun TotalCard(label: String, value: String) {
    Card(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
        Column(Modifier.padding(12.dp)) {
            Text(label, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(value, style = MaterialTheme.typography.titleLarge)
        }
    }
}

/** Horizontally scrolling row of period chips (text buttons only). */
@Composable
fun PeriodChips(
    periods: List<ReportPeriod>,
    selected: ReportPeriod,
    onSelect: (ReportPeriod) -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        for (p in periods) {
            if (p == selected) {
                Button(onClick = { onSelect(p) }) { Text(p.label) }
            } else {
                OutlinedButton(onClick = { onSelect(p) }) { Text(p.label) }
            }
        }
    }
}

/** From/to date inputs for a custom range. */
@Composable
fun CustomRangeInputs(
    from: String,
    to: String,
    onFrom: (String) -> Unit,
    onTo: (String) -> Unit,
    onApply: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        TextField(
            value = from,
            onValueChange = onFrom,
            label = { Text("From (YYYY-MM-DD)") },
            modifier = Modifier.weight(1f),
            singleLine = true,
        )
        TextField(
            value = to,
            onValueChange = onTo,
            label = { Text("To (YYYY-MM-DD)") },
            modifier = Modifier.weight(1f),
            singleLine = true,
        )
    }
    Spacer(Modifier.height(8.dp))
    Button(onClick = onApply, modifier = Modifier.fillMaxWidth()) { Text("Show") }
}
