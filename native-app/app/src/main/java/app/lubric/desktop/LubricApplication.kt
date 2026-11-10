package app.lubric.desktop

import android.app.Application
import androidx.work.Configuration
import app.lubric.desktop.data.sync.SyncWorkerFactory
import app.lubric.desktop.di.AppContainer

/**
 * Owns the single [AppContainer] and supplies WorkManager's custom
 * configuration. The periodic [SyncWorker] takes its repository as a
 * constructor parameter (manual DI, no Hilt), so WorkManager cannot build
 * it with its default factory — [getWorkManagerConfiguration] registers
 * [SyncWorkerFactory] here. (WorkManager's startup initializer honours
 * Configuration.Provider, so no manifest initializer removal is needed.)
 */
class LubricApplication : Application(), Configuration.Provider {

    val container: AppContainer by lazy { AppContainer(applicationContext) }

    override fun getWorkManagerConfiguration(): Configuration =
        Configuration.Builder()
            .setWorkerFactory(SyncWorkerFactory(container.syncRepository))
            .build()
}
