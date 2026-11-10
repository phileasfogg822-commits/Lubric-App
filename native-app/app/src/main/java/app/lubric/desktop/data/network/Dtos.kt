package app.lubric.desktop.data.network

import com.google.gson.JsonObject
import com.google.gson.annotations.SerializedName

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

data class LoginRequest(
    val email: String,
    val password: String,
)

/**
 * The user object inside the login JWT payload / response. `shop_id` is the
 * user's home outlet. There is deliberately NO password_hash field here:
 * the server returns it on /api/auth/me, but the client must never parse,
 * store or display it.
 */
data class UserDto(
    val id: Int,
    val email: String,
    val role: String? = null,
    @SerializedName("shop_id") val shopId: Int? = null,
    @SerializedName("full_name") val fullName: String? = null,
)

data class ShopDto(
    val id: Int,
    val role: String? = null,
    val name: String? = null,
    val address: String? = null,
    val phone: String? = null,
)

data class LoginResponse(
    val token: String,
    val user: UserDto,
    val shops: List<ShopDto> = emptyList(),
)

data class MeResponse(
    val user: UserDto,
)

// ---------------------------------------------------------------------------
// Device pairing / ping
// ---------------------------------------------------------------------------

data class PairRequest(
    val code: String,
    val name: String,
)

data class DeviceDto(
    val id: Int? = null,
    @SerializedName("shop_id") val shopId: Int? = null,
    val kind: String? = null,
)

data class PairResponse(
    val token: String,
    val device: DeviceDto? = null,
)

data class PingResponse(
    val ok: Boolean? = null,
    @SerializedName("server_time") val serverTime: String? = null,
    val device: DeviceDto? = null,
    val counts: Map<String, Int>? = null,
)

// ---------------------------------------------------------------------------
// Sync: pull / push
// ---------------------------------------------------------------------------

/**
 * Pull response. `changes` is a per-table map of full row objects; values
 * stay as [JsonObject] so booleans and nested JSON survive untouched until
 * [app.lubric.desktop.data.sync.SyncNormalize] converts them to bindable
 * SQLite values (booleans -> 0/1, objects/arrays -> JSON text).
 * `cursor` is a server ms epoch.
 */
data class PullResponse(
    val cursor: Long = 0L,
    @SerializedName("server_time") val serverTime: String? = null,
    @SerializedName("sync_requested_at") val syncRequestedAt: String? = null,
    val changes: Map<String, List<JsonObject>> = emptyMap(),
)

data class PushChange(
    val table: String,
    val uuid: String,
    val op: String,
    /** Full row as JSON, minus `id` (the server owns `id`). */
    val row: JsonObject,
)

data class PushRequest(
    val changes: List<PushChange>,
)

data class AppliedChange(
    val table: String? = null,
    val uuid: String? = null,
    val op: String? = null,
)

data class RejectedChange(
    val uuid: String? = null,
    val reason: String? = null,
)

data class PushResponse(
    val applied: List<AppliedChange> = emptyList(),
    val rejected: List<RejectedChange> = emptyList(),
)

// ---------------------------------------------------------------------------
// Generic SQL endpoints (the web app is a thin SQL client; these are the
// same three endpoints, user token + X-Shop-Id, for later phases)
// ---------------------------------------------------------------------------

/** Money arrives as JSON floats (server NUMERIC parsed to float); Double in DTOs. */
data class SqlRequest(
    val sql: String,
    val params: List<Any?>? = null,
)

data class ExecuteResponse(
    @SerializedName("rowCount") val rowCount: Int = 0,
    val rows: List<Map<String, Any?>>? = null,
)

data class TransactionRequest(
    val statements: List<SqlRequest>,
)

data class TransactionResponse(
    val results: List<ExecuteResponse>? = null,
)

// ---------------------------------------------------------------------------
// Config & feature flags (Package F: White Label)
// ---------------------------------------------------------------------------

/**
 * One row of the `config` table, as GET /api/config returns it (a bare JSON
 * array of rows; server `server/index.js` selects key, value, shop_id,
 * updated_at). `value` is TEXT on the server — branding keys hold plain
 * strings, `included_modules` holds a JSON array encoded as a string.
 * Which rows a caller may see depends on the session: the public branding
 * keys (app_name, primary_color, default_branding) are readable pre-login,
 * `included_modules` needs any signed-in session, everything else needs
 * admin / shop.manage.
 */
data class ConfigRowDto(
    val key: String,
    val value: String? = null,
    @SerializedName("shop_id") val shopId: Int? = null,
    @SerializedName("updated_at") val updatedAt: String? = null,
)

/**
 * One row of `feature_flags`, as GET /api/feature-flags returns it (a bare
 * JSON array of rows: key, enabled, shop_id, updated_at). Reading needs a
 * signed-in session; `enabled` is a real JSON boolean on the wire.
 */
data class FeatureFlagDto(
    val key: String,
    val enabled: Boolean = true,
    @SerializedName("shop_id") val shopId: Int? = null,
    @SerializedName("updated_at") val updatedAt: String? = null,
)
