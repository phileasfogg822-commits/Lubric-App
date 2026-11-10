package app.lubric.desktop.data.network

/**
 * In-memory copy of the current tokens, so the OkHttp interceptor can read
 * them without touching DataStore on every request. Updated by the
 * repositories whenever tokens are saved or loaded ([TokenStore] writes
 * through to here).
 */
class TokenHolder {
    @Volatile
    var userToken: String? = null

    @Volatile
    var deviceToken: String? = null

    /** Active outlet id, sent as X-Shop-Id on user-token calls. */
    @Volatile
    var shopId: Int? = null
}
