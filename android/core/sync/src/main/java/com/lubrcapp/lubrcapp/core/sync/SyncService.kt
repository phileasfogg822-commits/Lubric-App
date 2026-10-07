package com.lubrcapp.lubrcapp.core.sync

import android.content.Context
import androidx.work.Worker
import androidx.work.WorkerParameters
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Sync service for offline-first operation.
 *
 * Manages the sync queue:
 * - Local operations queued when offline
 * - WorkManager processes queued operations when online
 * - Conflict resolution (last-write-wins, merge, or manual)
 * - Sync status tracking
 * - Retry with backoff
 */
class SyncService(private val context: Context) {
    private val _syncStatus = MutableStateFlow(SyncStatus())
    val syncStatus: StateFlow<SyncStatus> = _syncStatus.asStateFlow()

    private val syncQueue = mutableListOf<SyncOperation>()

    fun getSyncStatus(): SyncStatus = _syncStatus.value

    fun enqueue(operation: SyncOperation) {
        syncQueue.add(operation)
        _syncStatus.value = _syncStatus.value.copy(
            pendingCount = _syncStatus.value.pendingCount + 1
        )
    }

    fun remove(operationId: String) {
        syncQueue.removeAll { it.id == operationId }
        _syncStatus.value = _syncStatus.value.copy(
            pendingCount = _syncStatus.value.pendingCount - 1
        )
    }

    fun clearQueue() {
        syncQueue.clear()
        _syncStatus.value = _syncStatus.value.copy(
            pendingCount = 0,
            failedCount = 0
        )
    }

    fun getPendingCount(): Int = _syncStatus.value.pendingCount
    fun getFailedCount(): Int = _syncStatus.value.failedCount

    fun setConnected(isConnected: Boolean) {
        _syncStatus.value = _syncStatus.value.copy(
            connected = isConnected,
            lastSync = if (isConnected) System.currentTimeMillis() else _syncStatus.value.lastSync
        )
    }

    fun processSyncQueue() {
        // In production, trigger WorkManager
        _syncStatus.value = _syncStatus.value.copy(lastSync = System.currentTimeMillis())
    }
}

data class SyncStatus(
    val connected: Boolean = false,
    val lastSync: Long = 0,
    val pendingCount: Int = 0,
    val failedCount: Int = 0,
    val totalCount: Int = 0,
)

open class SyncWorker(
    context: Context,
    params: WorkerParameters
) : Worker(context, params) {
    override fun doWork(): Result {
        // Process sync queue
        return Result.success()
    }
}

data class SyncOperation(
    val id: String,
    val type: OperationType,
    val entityId: String,
    val action: String,
    val payload: String,
    val timestamp: Long = System.currentTimeMillis(),
)

enum class OperationType {
    CREATE, UPDATE, DELETE, SYNC
}

