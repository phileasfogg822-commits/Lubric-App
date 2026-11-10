package app.lubric.desktop.data.sync

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters

/**
 * Periodic background sync worker. Runs one [SyncRepository.syncNow]
 * round and always returns [Result.success] — even on sync failure — so a
 * failed round never kills the periodic chain; the failure is already
 * recorded in the repository's [SyncState].
 *
 * The worker takes its [SyncRepository] as a constructor parameter (manual
 * DI, no Hilt). WorkManager needs a [WorkerFactory] to build it: the app
 * supplies [SyncWorkerFactory] from its AppContainer at startup.
 */
class SyncWorker(
    appContext: Context,
    params: WorkerParameters,
    private val syncRepository: SyncRepository,
) : CoroutineWorker(appContext, params) {

    override suspend fun doWork(): Result {
        return try {
            syncRepository.syncNow()
            Result.success()
        } catch (_: Exception) {
            // syncNow already records the error in SyncState; a throw here
            // would only mark the work failed and risk backoff churn.
            Result.success()
        }
    }
}
