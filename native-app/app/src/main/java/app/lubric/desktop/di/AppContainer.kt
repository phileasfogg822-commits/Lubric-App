package app.lubric.desktop.di

import android.content.Context
import app.lubric.desktop.data.auth.AuthRepository
import app.lubric.desktop.data.db.LubricDatabase
import app.lubric.desktop.data.network.ApiClient
import app.lubric.desktop.data.network.LubricApi
import app.lubric.desktop.data.network.TokenHolder
import app.lubric.desktop.data.store.TokenStore
import app.lubric.desktop.data.sync.SyncRepository

/**
 * Manual dependency container, created once in MainActivity and passed down
 * to the navigation graph. No Hilt, and no shared singletons: the Room
 * database is built once here via [LubricDatabase.build] and held as a lazy
 * val like everything else.
 *
 * Assumption: the data layer lives under `app.lubric.desktop.data.*` — the
 * task contract names its packages relative to the app package (e.g.
 * `data.store.TokenStore`). If the data layer lands in a different package,
 * only the imports in this file need to change; the construction order and
 * constructor arguments below follow the contract exactly.
 *
 * Two deviations from the brief's contract, forced by the data layer as
 * actually landed (verified against its source, not assumed):
 * - `ApiClient.create()` takes the [TokenHolder] (`create(tokenHolder)`),
 *   so the auth interceptor can read the current tokens.
 * - `LubricDatabase` has no `getInstance()` singleton; it exposes
 *   `build(context)`. This container is created once, so `build` still runs
 *   exactly once.
 * `SyncRepository` itself had not landed yet when this file was written, so
 * its construction (`SyncRepository(api, database, tokenStore)`) follows the
 * brief's contract as specified.
 */
class AppContainer(context: Context) {

    private val appContext: Context = context.applicationContext

    val tokenHolder: TokenHolder by lazy { TokenHolder() }

    val tokenStore: TokenStore by lazy { TokenStore(appContext, tokenHolder) }

    val api: LubricApi by lazy { ApiClient.create(tokenHolder) }

    val database: LubricDatabase by lazy { LubricDatabase.build(appContext) }

    val authRepository: AuthRepository by lazy { AuthRepository(tokenStore, api) }

    val syncRepository: SyncRepository by lazy { SyncRepository(api, database, tokenStore) }
}
