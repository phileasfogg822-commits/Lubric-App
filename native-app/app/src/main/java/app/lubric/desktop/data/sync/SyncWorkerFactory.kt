package app.lubric.desktop.data.sync

import android.content.Context
import androidx.work.ListenableWorker
import androidx.work.WorkerFactory
import androidx.work.WorkerParameters

/**
 * Builds [SyncWorker] with its [SyncRepository]. Registered with
 * WorkManager from the Application's AppContainer (manual DI — no Hilt),
 * e.g. via `WorkManager.initialize` with a custom Configuration, or
 * `Configuration.Provider` on the Application class.
 */
class SyncWorkerFactory(
    private val syncRepository: SyncRepository,
) : WorkerFactory() {

    override fun createWorker(
        appContext: Context,
        workerClassName: String,
        workerParameters: WorkerParameters,
    ): ListenableWorker? {
        return if (workerClassName == SyncWorker::class.java.name) {
            SyncWorker(appContext, workerParameters, syncRepository)
        } else {
            null
        }
    }
}
