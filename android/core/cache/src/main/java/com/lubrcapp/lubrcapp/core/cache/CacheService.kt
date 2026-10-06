package com.lubrcapp.lubrcapp.core.cache

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

private val Context.dataStore: DataStore<Preferences> by preferencesDataStore(name = "lubrcapp_preferences")

/**
 * Simple in-memory + disk cache service.
 */
class CacheService {
    private val cache = mutableMapOf<String, Any>()
    private var lastCleanup = 0L

    fun set(key: String, value: Any, expiryMs: Long = 3600000) {
        cache[key] = CacheEntry(value, System.currentTimeMillis() + expiryMs)
    }

    fun get(key: String): Any? {
        val entry = cache[key] ?: return null
        if (System.currentTimeMillis() > entry.expiry) {
            cache.remove(key)
            return null
        }
        return entry.value
    }

    fun <T> getFlow(key: String, defaultValue: T): Flow<T> {
        // In production, this would wrap DataStore flows
        return kotlinx.coroutines.flow.flow { emit(defaultValue) }
    }

    fun remove(key: String) {
        cache.remove(key)
    }

    fun clear() {
        cache.clear()
    }

    fun cleanup(expiryMs: Long = 3600000) {
        val now = System.currentTimeMillis()
        if (now - lastCleanup > 3600000) {
            cache.entries.removeIf { it.value as? CacheEntry ?: false }
            lastCleanup = now
        }
    }
}

private data class CacheEntry<T>(val value: T, val expiry: Long)

