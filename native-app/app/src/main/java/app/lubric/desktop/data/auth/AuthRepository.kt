package app.lubric.desktop.data.auth

import app.lubric.desktop.data.network.LoginRequest
import app.lubric.desktop.data.network.LubricApi
import app.lubric.desktop.data.network.ShopDto
import app.lubric.desktop.data.store.TokenStore
import com.google.gson.JsonParser
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import retrofit2.HttpException

data class AuthSession(
    val userId: Int,
    val email: String,
    val name: String,
    val shopId: Int,
    val shops: List<ShopDto> = emptyList(),
)

/**
 * User login session. The device token is a separate concern (pairing) and
 * is untouched here.
 */
class AuthRepository(
    private val tokenStore: TokenStore,
    private val api: LubricApi,
) {
    private val _session = MutableStateFlow<AuthSession?>(null)

    /** Null until [loadSession] restores a saved session at startup. */
    val session: StateFlow<AuthSession?> = _session.asStateFlow()

    /**
     * Restores a saved session from TokenStore. Called once by the UI at
     * startup — no I/O happens in init.
     */
    suspend fun loadSession() {
        val token = tokenStore.userToken.first()
        if (token == null) {
            _session.value = null
            return
        }
        _session.value = AuthSession(
            userId = tokenStore.userId.first() ?: 0,
            email = tokenStore.userEmail.first() ?: "",
            name = tokenStore.userName.first() ?: "",
            shopId = tokenStore.shopId.first() ?: 0,
        )
    }

    /**
     * Logs in, saves the user token + active shop, and returns the session.
     * The active shop is the user's home outlet (`user.shop_id` from the
     * login response); when the user belongs to several shops the full list
     * is exposed in the session for an outlet picker in a later phase.
     * A failure carries the server's error message when the body has one.
     */
    suspend fun login(email: String, password: String): Result<AuthSession> {
        return try {
            val response = api.login(LoginRequest(email, password))
            val shopId = response.user.shopId
                ?: response.shops.firstOrNull()?.id
                ?: 0
            tokenStore.saveUserSession(
                token = response.token,
                userId = response.user.id,
                shopId = shopId,
                userName = response.user.fullName ?: "",
                email = response.user.email,
            )
            val session = AuthSession(
                userId = response.user.id,
                email = response.user.email,
                name = response.user.fullName ?: "",
                shopId = shopId,
                shops = response.shops,
            )
            _session.value = session
            Result.success(session)
        } catch (e: HttpException) {
            Result.failure(Exception(serverErrorMessage(e) ?: "Login failed (${e.code()})"))
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * Logs out: clears the user token + session. The device token is
     * deliberately KEPT — unpairing is a separate Phase 2 concern, and a
     * logout must not force the shop to re-pair the device.
     */
    suspend fun logout() {
        tokenStore.clearUserSession()
        _session.value = null
    }

    /** Best-effort extraction of the server's {"error": "..."} message. */
    private fun serverErrorMessage(e: HttpException): String? {
        return try {
            val body = e.response()?.errorBody()?.string() ?: return null
            val json = JsonParser.parseString(body).asJsonObject
            json.get("error")?.asString ?: json.get("message")?.asString
        } catch (_: Exception) {
            null
        }
    }
}
