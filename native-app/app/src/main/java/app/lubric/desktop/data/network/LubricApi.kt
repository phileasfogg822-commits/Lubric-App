package app.lubric.desktop.data.network

import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Query

/**
 * Retrofit API for the Lubric hub. One instance, base URL =
 * BuildConfig.HUB_URL + "/" (bare origin — the paths below are absolute
 * within it, so the origin must NOT carry an /api suffix).
 *
 * Auth scheme: `Authorization: Bearer <token>` everywhere. Device-token
 * calls go to /api/v1/*; user-token calls (auth + generic SQL) go to
 * /api/* and also carry X-Shop-Id (see the interceptor in ApiClient).
 */
interface LubricApi {

    // -- Auth (user token) -------------------------------------------------

    @POST("api/auth/login")
    suspend fun login(@Body request: LoginRequest): LoginResponse

    @GET("api/auth/me")
    suspend fun me(): MeResponse

    // -- Device pairing + sync (device token) ------------------------------

    @POST("api/v1/devices/pair")
    suspend fun pair(@Body request: PairRequest): PairResponse

    @GET("api/v1/ping")
    suspend fun ping(): PingResponse

    /** `since` is a ms-epoch cursor (sync_state pull_cursor, starts at 0). */
    @GET("api/v1/pull")
    suspend fun pull(@Query("since") since: Long): PullResponse

    @POST("api/v1/push")
    suspend fun push(@Body request: PushRequest): PushResponse

    // -- Generic SQL endpoints (user token + X-Shop-Id, for later phases) --

    /** Returns a bare JSON array of rows. */
    @POST("api/query")
    suspend fun query(@Body request: SqlRequest): List<Map<String, Any?>>

    @POST("api/execute")
    suspend fun execute(@Body request: SqlRequest): ExecuteResponse

    @POST("api/transaction")
    suspend fun transaction(@Body request: TransactionRequest): TransactionResponse
}
