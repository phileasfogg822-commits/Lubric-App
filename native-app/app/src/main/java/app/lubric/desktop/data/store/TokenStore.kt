package app.lubric.desktop.data.store

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import app.lubric.desktop.data.network.ShopDto
import app.lubric.desktop.data.network.TokenHolder
import com.google.gson.Gson
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

private val Context.tokenDataStore: DataStore<Preferences> by preferencesDataStore(
    name = "lubric_tokens",
)

/**
 * Token + session persistence (DataStore Preferences, file "lubric_tokens").
 *
 * Keys mirror the web app's localStorage keys: `lubric_device_token` for
 * the device token; the user session (token, shop, name, email) is what
 * the web app keeps in its auth state. Every save also updates the
 * [TokenHolder] volatile vars so the OkHttp interceptor sees the new
 * tokens immediately.
 *
 * Note: `saveUserSession` also takes the user id (stored under `user_id`).
 * The brief's signature had no user-id key, but [app.lubric.desktop.data.auth.AuthSession]
 * carries a userId and must survive a restart, so the key was added rather
 * than restoring sessions with a placeholder id.
 */
class TokenStore(
    context: Context,
    private val tokenHolder: TokenHolder,
) {
    private val dataStore: DataStore<Preferences> = context.tokenDataStore

    val userToken: Flow<String?> = dataStore.data.map { it[KEY_USER_TOKEN] }
    val deviceToken: Flow<String?> = dataStore.data.map { it[KEY_DEVICE_TOKEN] }
    val userId: Flow<Int?> = dataStore.data.map { it[KEY_USER_ID] }
    val shopId: Flow<Int?> = dataStore.data.map { it[KEY_SHOP_ID] }
    val userName: Flow<String?> = dataStore.data.map { it[KEY_USER_NAME] }
    val userEmail: Flow<String?> = dataStore.data.map { it[KEY_USER_EMAIL] }
    val shopsJson: Flow<String?> = dataStore.data.map { it[KEY_SHOPS_JSON] }

    private val gson = Gson()

    suspend fun saveUserSession(
        token: String,
        userId: Int,
        shopId: Int,
        userName: String,
        email: String,
    ) {
        dataStore.edit { prefs ->
            prefs[KEY_USER_TOKEN] = token
            prefs[KEY_USER_ID] = userId
            prefs[KEY_SHOP_ID] = shopId
            prefs[KEY_USER_NAME] = userName
            prefs[KEY_USER_EMAIL] = email
        }
        tokenHolder.userToken = token
        tokenHolder.shopId = shopId
    }

    suspend fun saveDeviceToken(token: String) {
        dataStore.edit { prefs ->
            prefs[KEY_DEVICE_TOKEN] = token
        }
        tokenHolder.deviceToken = token
    }

    suspend fun setShopId(id: Int) {
        dataStore.edit { prefs ->
            prefs[KEY_SHOP_ID] = id
        }
        tokenHolder.shopId = id
    }

    /**
     * Persist the outlet list from login, so the shop picker survives a
     * restart (Phase 1 kept it only in memory for the login turn).
     */
    suspend fun saveShops(shops: List<ShopDto>) {
        dataStore.edit { prefs ->
            prefs[KEY_SHOPS_JSON] = gson.toJson(shops)
        }
    }

    /** The persisted outlet list, empty when nothing was saved yet. */
    suspend fun loadShops(): List<ShopDto> {
        val json = shopsJson.first() ?: return emptyList()
        return try {
            gson.fromJson(json, Array<ShopDto>::class.java)?.toList() ?: emptyList()
        } catch (_: Exception) {
            emptyList()
        }
    }

    /**
     * Restore the in-memory [TokenHolder] from DataStore. Phase 1 never did
     * this: after a process restart the holder stayed null even though the
     * session and device token were restored, so user-token and device calls
     * went out without Authorization / X-Shop-Id. Call once at startup.
     */
    suspend fun restoreTokens() {
        tokenHolder.userToken = userToken.first()
        tokenHolder.deviceToken = deviceToken.first()
        tokenHolder.shopId = shopId.first()
    }

    /** Clears the user session only; the device token is kept (see AuthRepository.logout). */
    suspend fun clearUserSession() {
        dataStore.edit { prefs ->
            prefs.remove(KEY_USER_TOKEN)
            prefs.remove(KEY_USER_ID)
            prefs.remove(KEY_SHOP_ID)
            prefs.remove(KEY_USER_NAME)
            prefs.remove(KEY_USER_EMAIL)
            prefs.remove(KEY_SHOPS_JSON)
        }
        tokenHolder.userToken = null
        tokenHolder.shopId = null
    }

    suspend fun clearAll() {
        dataStore.edit { prefs -> prefs.clear() }
        tokenHolder.userToken = null
        tokenHolder.deviceToken = null
        tokenHolder.shopId = null
    }

    companion object {
        private val KEY_USER_TOKEN = stringPreferencesKey("user_token")
        private val KEY_DEVICE_TOKEN = stringPreferencesKey("device_token")
        private val KEY_USER_ID = intPreferencesKey("user_id")
        private val KEY_SHOP_ID = intPreferencesKey("shop_id")
        private val KEY_USER_NAME = stringPreferencesKey("user_name")
        private val KEY_USER_EMAIL = stringPreferencesKey("user_email")
        private val KEY_SHOPS_JSON = stringPreferencesKey("shops_json")
    }
}
