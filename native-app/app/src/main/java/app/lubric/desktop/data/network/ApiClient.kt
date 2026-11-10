package app.lubric.desktop.data.network

import app.lubric.desktop.BuildConfig
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.Response
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.util.concurrent.TimeUnit

/**
 * Builds the single [LubricApi] instance.
 *
 * No automatic retry on push: retries are the repository's job, with
 * idempotency by uuid (a blind OkHttp retry could double-apply a push
 * whose response was lost). Timeouts are 30s each way.
 */
object ApiClient {

    fun create(tokenHolder: TokenHolder): LubricApi {
        val client = OkHttpClient.Builder()
            .addInterceptor(AuthInterceptor(tokenHolder))
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            .build()
        return Retrofit.Builder()
            .baseUrl(BuildConfig.HUB_URL + "/")
            .client(client)
            .addConverterFactory(GsonConverterFactory.create())
            .build()
            .create(LubricApi::class.java)
    }
}

/**
 * Attaches the right token per path: requests under /api/v1/ are device
 * calls (device token); everything else is a user call (user token plus
 * X-Shop-Id for the active outlet, when known). A missing token simply
 * sends no Authorization header — the server answers 401 and the
 * repository surfaces it.
 */
class AuthInterceptor(private val holder: TokenHolder) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        val builder = request.newBuilder()
        if (request.url.encodedPath.startsWith("/api/v1/")) {
            holder.deviceToken?.let { builder.header("Authorization", "Bearer $it") }
        } else {
            holder.userToken?.let { builder.header("Authorization", "Bearer $it") }
            holder.shopId?.let { builder.header("X-Shop-Id", it.toString()) }
        }
        return chain.proceed(builder.build())
    }
}
