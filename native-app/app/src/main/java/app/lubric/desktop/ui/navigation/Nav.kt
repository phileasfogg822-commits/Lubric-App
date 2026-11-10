package app.lubric.desktop.ui.navigation

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import app.lubric.desktop.di.AppContainer
import app.lubric.desktop.ui.accounts.AccountDetailScreen
import app.lubric.desktop.ui.accounts.AccountDetailViewModel
import app.lubric.desktop.ui.accounts.AccountsScreen
import app.lubric.desktop.ui.accounts.AccountsViewModel
import app.lubric.desktop.ui.accounts.ROUTE_ACCOUNT_DETAIL
import app.lubric.desktop.ui.accounts.ROUTE_ACCOUNTS
import app.lubric.desktop.ui.accounts.accountDetailRoute
import app.lubric.desktop.ui.branding.WHITELABEL_ROUTE
import app.lubric.desktop.ui.branding.WhiteLabelScreen
import app.lubric.desktop.ui.branding.WhiteLabelViewModel
import app.lubric.desktop.ui.customers.CustomerDetailScreen
import app.lubric.desktop.ui.customers.CustomerDetailViewModel
import app.lubric.desktop.ui.customers.CustomersScreen
import app.lubric.desktop.ui.customers.CustomersViewModel
import app.lubric.desktop.ui.expenses.ExpensesScreen
import app.lubric.desktop.ui.expenses.ExpensesViewModel
import app.lubric.desktop.ui.expenses.ROUTE_EXPENSES
import app.lubric.desktop.ui.field.FIELD_ROUTE
import app.lubric.desktop.ui.field.FieldActivityScreen
import app.lubric.desktop.ui.field.FieldActivityViewModel
import app.lubric.desktop.ui.home.HomeScreen
import app.lubric.desktop.ui.home.HomeViewModel
import app.lubric.desktop.ui.inspections.INSPECTIONS_ROUTE
import app.lubric.desktop.ui.inspections.InspectionsScreen
import app.lubric.desktop.ui.inspections.InspectionsViewModel
import app.lubric.desktop.ui.khata.KHATA_ROUTE
import app.lubric.desktop.ui.khata.KhataScreen
import app.lubric.desktop.ui.khata.KhataViewModel
import app.lubric.desktop.ui.login.LoginScreen
import app.lubric.desktop.ui.login.LoginViewModel
import app.lubric.desktop.ui.pairing.PairingScreen
import app.lubric.desktop.ui.pairing.PairingViewModel
import app.lubric.desktop.ui.products.ProductsScreen
import app.lubric.desktop.ui.products.ProductsViewModel
import app.lubric.desktop.ui.purchases.PURCHASES_ROUTE
import app.lubric.desktop.ui.purchases.PURCHASE_DETAIL_ROUTE
import app.lubric.desktop.ui.purchases.PurchaseDetailScreen
import app.lubric.desktop.ui.purchases.PurchasesScreen
import app.lubric.desktop.ui.purchases.PurchasesViewModel
import app.lubric.desktop.ui.purchases.purchaseDetailRoute
import app.lubric.desktop.ui.reminders.REMINDERS_ROUTE
import app.lubric.desktop.ui.reminders.RemindersScreen
import app.lubric.desktop.ui.reminders.RemindersViewModel
import app.lubric.desktop.ui.reports.PROFIT_ROUTE
import app.lubric.desktop.ui.reports.ProfitLossScreen
import app.lubric.desktop.ui.reports.ProfitLossViewModel
import app.lubric.desktop.ui.reports.REPORTS_ROUTE
import app.lubric.desktop.ui.reports.ReportsScreen
import app.lubric.desktop.ui.reports.ReportsViewModel
import app.lubric.desktop.ui.sale.SaleScreen
import app.lubric.desktop.ui.sale.SaleViewModel
import app.lubric.desktop.ui.shop.SHOP_ROUTE
import app.lubric.desktop.ui.shop.ShopSettingsScreen
import app.lubric.desktop.ui.shop.ShopSettingsViewModel
import app.lubric.desktop.ui.sync.SyncStatusScreen
import app.lubric.desktop.ui.sync.SyncStatusViewModel
import app.lubric.desktop.ui.team.TEAM_ROUTE
import app.lubric.desktop.ui.team.TeamScreen
import app.lubric.desktop.ui.team.TeamViewModel
import app.lubric.desktop.ui.transactions.TRANSACTIONS_ROUTE
import app.lubric.desktop.ui.transactions.TRANSACTION_DETAIL_ROUTE
import app.lubric.desktop.ui.transactions.TransactionDetailScreen
import app.lubric.desktop.ui.transactions.TransactionDetailViewModel
import app.lubric.desktop.ui.transactions.TransactionsScreen
import app.lubric.desktop.ui.transactions.TransactionsViewModel
import app.lubric.desktop.ui.transactions.transactionDetailRoute
import app.lubric.desktop.ui.vendors.VENDORS_ROUTE
import app.lubric.desktop.ui.vendors.VENDOR_DETAIL_ROUTE
import app.lubric.desktop.ui.vendors.VendorDetailScreen
import app.lubric.desktop.ui.vendors.VendorDetailViewModel
import app.lubric.desktop.ui.vendors.VendorsScreen
import app.lubric.desktop.ui.vendors.VendorsViewModel
import app.lubric.desktop.ui.vendors.vendorDetailRoute

/** Route names for the Phase 1 graph: login → pairing → home (+ sync detail). */
object Routes {
    const val LOGIN = "login"
    const val PAIRING = "pairing"
    const val HOME = "home"
    const val SYNC = "sync"
    // Phase 2 routes.
    const val SALE = "sale"
    const val CUSTOMERS = "customers"
    const val CUSTOMER_DETAIL = "customer_detail/{customerId}"
    const val PRODUCTS = "products"

    fun customerDetail(customerId: Long) = "customer_detail/$customerId"
}

/** Tiny ViewModel factory so screens can take repository constructor params. */
fun <VM : ViewModel> vmFactory(create: () -> VM): ViewModelProvider.Factory =
    object : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = create() as T
    }

/**
 * The Phase 1 navigation graph.
 *
 * Navigation is driven by observed auth/pairing state, never by a ViewModel
 * holding a NavController: this host collects the session and device-token
 * flows and moves between login / pairing / home whenever they change, with
 * the back stack cleared on every auth transition so Back never returns to
 * the login or pairing screens. The one exception is the sync detail screen,
 * which the user opens deliberately from home and stays on while the state
 * still points at home.
 *
 * [startDestination] is decided once by MainActivity after the session
 * restore finishes; later transitions come from the observer below.
 */
@Composable
fun LubricNavHost(
    navController: NavHostController,
    container: AppContainer,
    startDestination: String
) {
    val session by container.authRepository.session.collectAsState()
    val deviceToken by container.syncRepository.deviceToken.collectAsState(initial = null)
    val currentRoute = navController.currentBackStackEntryAsState().value?.destination?.route

    LaunchedEffect(session, deviceToken) {
        val target = when {
            session == null -> Routes.LOGIN
            deviceToken == null -> Routes.PAIRING
            else -> Routes.HOME
        }
        // The auth observer redirects to LOGIN/PAIRING/HOME, but must not
        // yank the user out of a deliberately opened detail screen (sync,
        // sale, customers, customer detail, products, and all Phase 3
        // screens) while the state still points at home.
        val detailRoutes = setOf(
            Routes.SYNC, Routes.SALE, Routes.CUSTOMERS,
            Routes.CUSTOMER_DETAIL, Routes.PRODUCTS,
            PURCHASES_ROUTE, PURCHASE_DETAIL_ROUTE, INSPECTIONS_ROUTE,
            ROUTE_ACCOUNTS, ROUTE_ACCOUNT_DETAIL, ROUTE_EXPENSES,
            TEAM_ROUTE, SHOP_ROUTE, WHITELABEL_ROUTE,
            VENDORS_ROUTE, VENDOR_DETAIL_ROUTE, KHATA_ROUTE,
            "khata/{partyType}/{partyId}",
            REPORTS_ROUTE, PROFIT_ROUTE,
            REMINDERS_ROUTE, TRANSACTIONS_ROUTE, TRANSACTION_DETAIL_ROUTE,
            FIELD_ROUTE,
        )
        val stayOnDetail = target == Routes.HOME && currentRoute in detailRoutes
        if (currentRoute != null && currentRoute != target && !stayOnDetail) {
            navController.navigate(target) {
                popUpTo(navController.graph.startDestinationId) { inclusive = true }
                launchSingleTop = true
            }
        }
    }

    NavHost(navController = navController, startDestination = startDestination) {
        composable(Routes.LOGIN) {
            val vm: LoginViewModel = viewModel(
                factory = vmFactory { LoginViewModel(container.authRepository) }
            )
            LoginScreen(vm)
        }
        composable(Routes.PAIRING) {
            val vm: PairingViewModel = viewModel(
                factory = vmFactory { PairingViewModel(container.syncRepository) }
            )
            PairingScreen(vm)
        }
        composable(Routes.HOME) {
            val vm: HomeViewModel = viewModel(
                factory = vmFactory {
                    HomeViewModel(
                        container.syncRepository,
                        container.authRepository,
                        container.dashboardRepository,
                    )
                }
            )
            HomeScreen(
                vm,
                onOpenSync = { navController.navigate(Routes.SYNC) },
                onOpenSale = { navController.navigate(Routes.SALE) },
                onOpenCustomers = { navController.navigate(Routes.CUSTOMERS) },
                onOpenProducts = { navController.navigate(Routes.PRODUCTS) },
                onOpenScreen = { route -> navController.navigate(route) },
            )
        }
        composable(Routes.SALE) {
            val vm: SaleViewModel = viewModel(
                factory = vmFactory {
                    SaleViewModel(
                        container.database,
                        container.saleRepository,
                        container.pricingRepository,
                    )
                }
            )
            // Session is non-null on this route (the auth observer only
            // leaves the user here when target == HOME); 0 is a fallback
            // that can never legitimately reach a write.
            SaleScreen(
                vm,
                userId = session?.userId ?: 0,
                shopId = session?.shopId ?: 0,
                onBack = { navController.popBackStack() },
                onSaleComplete = { navController.popBackStack() },
            )
        }
        composable(Routes.CUSTOMERS) {
            val vm: CustomersViewModel = viewModel(
                factory = vmFactory { CustomersViewModel(container.customerRepository) }
            )
            CustomersScreen(
                vm,
                shopId = session?.shopId ?: 0,
                onCustomerClick = { id -> navController.navigate(Routes.customerDetail(id)) },
                onBack = { navController.popBackStack() },
            )
        }
        composable(Routes.CUSTOMER_DETAIL) { backStackEntry ->
            val customerId =
                backStackEntry.arguments?.getString("customerId")?.toLongOrNull() ?: 0L
            val vm: CustomerDetailViewModel = viewModel(
                factory = vmFactory {
                    CustomerDetailViewModel(container.customerRepository, customerId)
                }
            )
            CustomerDetailScreen(
                vm,
                onBack = { navController.popBackStack() },
            )
        }
        composable(Routes.PRODUCTS) {
            val vm: ProductsViewModel = viewModel(
                factory = vmFactory { ProductsViewModel(container.catalogRepository) }
            )
            ProductsScreen(
                vm,
                shopId = session?.shopId ?: 0,
                onBack = { navController.popBackStack() },
            )
        }
        composable(Routes.SYNC) {
            val vm: SyncStatusViewModel = viewModel(
                factory = vmFactory { SyncStatusViewModel(container.syncRepository) }
            )
            SyncStatusScreen(vm, onBack = { navController.popBackStack() })
        }
        // Phase 3 screens.
        composable(PURCHASES_ROUTE) {
            val vm: PurchasesViewModel = viewModel(
                factory = vmFactory { PurchasesViewModel(container.purchaseRepository) }
            )
            PurchasesScreen(
                vm,
                shopId = session?.shopId ?: 0,
                onPurchaseClick = { id -> navController.navigate(purchaseDetailRoute(id)) },
                onBack = { navController.popBackStack() },
            )
        }
        composable(PURCHASE_DETAIL_ROUTE) { backStackEntry ->
            val purchaseOrderId =
                backStackEntry.arguments?.getString("purchaseOrderId")?.toLongOrNull() ?: 0L
            val vm: PurchasesViewModel = viewModel(
                factory = vmFactory { PurchasesViewModel(container.purchaseRepository) }
            )
            PurchaseDetailScreen(
                vm,
                purchaseOrderId = purchaseOrderId,
                onBack = { navController.popBackStack() },
            )
        }
        composable(INSPECTIONS_ROUTE) {
            val vm: InspectionsViewModel = viewModel(
                factory = vmFactory { InspectionsViewModel(container.inspectionRepository) }
            )
            InspectionsScreen(
                vm,
                shopId = session?.shopId ?: 0,
                onBack = { navController.popBackStack() },
            )
        }
        composable(ROUTE_ACCOUNTS) {
            val vm: AccountsViewModel = viewModel(
                factory = vmFactory { AccountsViewModel(container.accountRepository) }
            )
            AccountsScreen(
                vm,
                shopId = session?.shopId ?: 0,
                onAccountClick = { id -> navController.navigate(accountDetailRoute(id)) },
                onBack = { navController.popBackStack() },
            )
        }
        composable(ROUTE_ACCOUNT_DETAIL) { backStackEntry ->
            val accountId =
                backStackEntry.arguments?.getString("accountId")?.toLongOrNull() ?: 0L
            val vm: AccountDetailViewModel = viewModel(
                factory = vmFactory { AccountDetailViewModel(container.accountRepository) }
            )
            AccountDetailScreen(
                vm,
                accountId = accountId,
                onBack = { navController.popBackStack() },
            )
        }
        composable(ROUTE_EXPENSES) {
            val vm: ExpensesViewModel = viewModel(
                factory = vmFactory { ExpensesViewModel(container.expenseRepository) }
            )
            ExpensesScreen(
                vm,
                shopId = session?.shopId ?: 0,
                onBack = { navController.popBackStack() },
            )
        }
        composable(TEAM_ROUTE) {
            val vm: TeamViewModel = viewModel(
                factory = vmFactory { TeamViewModel(container.teamRepository) }
            )
            TeamScreen(vm, onBack = { navController.popBackStack() })
        }
        composable(SHOP_ROUTE) {
            val vm: ShopSettingsViewModel = viewModel(
                factory = vmFactory {
                    ShopSettingsViewModel(container.shopRepository, container.syncRepository)
                }
            )
            ShopSettingsScreen(
                vm,
                shopId = session?.shopId ?: 0,
                onBack = { navController.popBackStack() },
            )
        }
        composable(WHITELABEL_ROUTE) {
            val vm: WhiteLabelViewModel = viewModel(
                factory = vmFactory { WhiteLabelViewModel(container.brandingRepository) }
            )
            WhiteLabelScreen(vm, onBack = { navController.popBackStack() })
        }
        // Vendors + Khata.
        composable(VENDORS_ROUTE) {
            val vm: VendorsViewModel = viewModel(
                factory = vmFactory { VendorsViewModel(container.vendorRepository) }
            )
            VendorsScreen(
                vm,
                shopId = session?.shopId ?: 0,
                onVendorClick = { id -> navController.navigate(vendorDetailRoute(id)) },
                onOpenKhata = { id -> navController.navigate("khata/vendor/$id") },
                onBack = { navController.popBackStack() },
            )
        }
        composable(VENDOR_DETAIL_ROUTE) { backStackEntry ->
            val vendorId =
                backStackEntry.arguments?.getString("vendorId")?.toLongOrNull() ?: 0L
            val vm: VendorDetailViewModel = viewModel(
                factory = vmFactory {
                    VendorDetailViewModel(container.vendorRepository, vendorId)
                }
            )
            VendorDetailScreen(
                vm,
                onBack = { navController.popBackStack() },
                onDeleted = { navController.popBackStack() },
                onOpenKhata = { id -> navController.navigate("khata/vendor/$id") },
            )
        }
        composable(KHATA_ROUTE) {
            val vm: KhataViewModel = viewModel(
                factory = vmFactory { KhataViewModel(container.ledgerRepository) }
            )
            KhataScreen(
                vm,
                shopId = session?.shopId ?: 0,
                onBack = { navController.popBackStack() },
            )
        }
        composable("khata/{partyType}/{partyId}") { backStackEntry ->
            val partyType = backStackEntry.arguments?.getString("partyType") ?: "customer"
            val partyId = backStackEntry.arguments?.getString("partyId")?.toLongOrNull()
            val vm: KhataViewModel = viewModel(
                factory = vmFactory { KhataViewModel(container.ledgerRepository) }
            )
            KhataScreen(
                vm,
                shopId = session?.shopId ?: 0,
                onBack = { navController.popBackStack() },
                initialPartyType = partyType,
                initialPartyId = partyId,
            )
        }
        // Reports + Profit & Loss.
        composable(REPORTS_ROUTE) {
            val vm: ReportsViewModel = viewModel(
                factory = vmFactory { ReportsViewModel(container.reportRepository) }
            )
            ReportsScreen(
                vm,
                shopId = session?.shopId ?: 0,
                onBack = { navController.popBackStack() },
            )
        }
        composable(PROFIT_ROUTE) {
            val vm: ProfitLossViewModel = viewModel(
                factory = vmFactory { ProfitLossViewModel(container.reportRepository) }
            )
            ProfitLossScreen(
                vm,
                shopId = session?.shopId ?: 0,
                onBack = { navController.popBackStack() },
            )
        }
        // Reminders + Transactions + Field Activity.
        composable(REMINDERS_ROUTE) {
            val vm: RemindersViewModel = viewModel(
                factory = vmFactory { RemindersViewModel(container.reminderRepository) }
            )
            RemindersScreen(
                vm,
                shopId = session?.shopId ?: 0,
                onBack = { navController.popBackStack() },
            )
        }
        composable(TRANSACTIONS_ROUTE) {
            val vm: TransactionsViewModel = viewModel(
                factory = vmFactory { TransactionsViewModel(container.transactionsRepository) }
            )
            TransactionsScreen(
                vm,
                onOpenOrder = { id -> navController.navigate(transactionDetailRoute(id)) },
                onBack = { navController.popBackStack() },
            )
        }
        composable(TRANSACTION_DETAIL_ROUTE) { backStackEntry ->
            val orderId =
                backStackEntry.arguments?.getString("orderId")?.toLongOrNull() ?: 0L
            val vm: TransactionDetailViewModel = viewModel(
                factory = vmFactory {
                    TransactionDetailViewModel(container.transactionsRepository, orderId)
                }
            )
            TransactionDetailScreen(
                vm,
                onBack = { navController.popBackStack() },
            )
        }
        composable(FIELD_ROUTE) {
            val vm: FieldActivityViewModel = viewModel(
                factory = vmFactory { FieldActivityViewModel(container.fieldRepository) }
            )
            FieldActivityScreen(
                vm,
                onBack = { navController.popBackStack() },
            )
        }
    }
}
