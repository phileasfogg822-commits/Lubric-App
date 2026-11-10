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
import app.lubric.desktop.ui.customers.CustomerDetailScreen
import app.lubric.desktop.ui.customers.CustomerDetailViewModel
import app.lubric.desktop.ui.customers.CustomersScreen
import app.lubric.desktop.ui.customers.CustomersViewModel
import app.lubric.desktop.ui.home.HomeScreen
import app.lubric.desktop.ui.home.HomeViewModel
import app.lubric.desktop.ui.login.LoginScreen
import app.lubric.desktop.ui.login.LoginViewModel
import app.lubric.desktop.ui.pairing.PairingScreen
import app.lubric.desktop.ui.pairing.PairingViewModel
import app.lubric.desktop.ui.products.ProductsScreen
import app.lubric.desktop.ui.products.ProductsViewModel
import app.lubric.desktop.ui.sale.SaleScreen
import app.lubric.desktop.ui.sale.SaleViewModel
import app.lubric.desktop.ui.sync.SyncStatusScreen
import app.lubric.desktop.ui.sync.SyncStatusViewModel

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
        // sale, customers, customer detail, products) while the state
        // still points at home.
        val detailRoutes = setOf(
            Routes.SYNC, Routes.SALE, Routes.CUSTOMERS,
            Routes.CUSTOMER_DETAIL, Routes.PRODUCTS,
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
    }
}
