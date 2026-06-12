package expo.modules.appattest

import com.google.android.play.core.integrity.IntegrityManagerFactory
import com.google.android.play.core.integrity.StandardIntegrityManager
import com.google.android.play.core.integrity.StandardIntegrityManager.PrepareIntegrityTokenRequest
import com.google.android.play.core.integrity.StandardIntegrityManager.StandardIntegrityToken
import com.google.android.play.core.integrity.StandardIntegrityManager.StandardIntegrityTokenProvider
import com.google.android.play.core.integrity.StandardIntegrityManager.StandardIntegrityTokenRequest
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Android device-attestation bridge backed by the Play Integrity API.
 *
 * Android has no Apple-style App Attest, so the cross-platform JS surface maps
 * onto Play Integrity's Standard request flow:
 *   - generateKey()  -> prepareIntegrityToken() (warms up + caches the provider)
 *   - attestKey()    -> provider.request(requestHash) -> the Play Integrity JWT
 *
 * Per #proj-onramp-app-2-app: the JWT (~1-2 KB) is too large for a deep-link
 * param, so the partner app sends it to the backend for validation and only
 * deep-links the resulting session identifier. There is no Apple-style keyId,
 * so generateKey() resolves to "" and keyId is ignored by attestKey().
 */
class AppAttestModule : Module() {
  // TODO: set this to the Google Cloud project NUMBER (not ID) linked to the
  // app in Play Console > Play Integrity. Required for Standard requests.
  // Prefer injecting via BuildConfig / manifest meta-data for real builds.
  private val cloudProjectNumber: Long = 0L

  private var integrityManager: StandardIntegrityManager? = null
  private var tokenProvider: StandardIntegrityTokenProvider? = null

  override fun definition() = ModuleDefinition {
    Name("AppAttest")

    Constants(
      "provider" to "android-play-integrity"
    )

    AsyncFunction("isSupported") {
      // Play Integrity availability is ultimately resolved by prepare/request;
      // creating the manager is a cheap, reliable readiness signal here.
      try {
        val context = appContext.reactContext
          ?: throw CodedException("E_NO_CONTEXT", "React context unavailable", null)
        IntegrityManagerFactory.createStandard(context)
        true
      } catch (e: Exception) {
        false
      }
    }

    AsyncFunction("generateKey") { promise: Promise ->
      try {
        if (cloudProjectNumber == 0L) {
          promise.reject(
            "E_NOT_CONFIGURED",
            "cloudProjectNumber is not set — configure it in AppAttestModule.kt",
            null
          )
          return@AsyncFunction
        }
        val context = appContext.reactContext
          ?: throw CodedException("E_NO_CONTEXT", "React context unavailable", null)
        val manager = IntegrityManagerFactory.createStandard(context)
        integrityManager = manager
        manager.prepareIntegrityToken(
          PrepareIntegrityTokenRequest.builder()
            .setCloudProjectNumber(cloudProjectNumber)
            .build()
        )
          .addOnSuccessListener { provider ->
            tokenProvider = provider
            // No Apple-style keyId on Android; identity is the integrity verdict.
            promise.resolve("")
          }
          .addOnFailureListener { e ->
            promise.reject("E_PREPARE", e.message ?: "prepareIntegrityToken failed", e)
          }
      } catch (e: Exception) {
        promise.reject("E_PREPARE", e.message ?: "prepareIntegrityToken failed", e)
      }
    }

    // keyId is unused on Android; clientDataHashB64 is bound as the requestHash.
    AsyncFunction("attestKey") { _: String, clientDataHashB64: String, promise: Promise ->
      try {
        val provider = tokenProvider
          ?: throw CodedException(
            "E_NOT_PREPARED",
            "Integrity token provider not ready — call generateKey() first",
            null
          )
        provider.request(
          StandardIntegrityTokenRequest.builder()
            .setRequestHash(clientDataHashB64)
            .build()
        )
          .addOnSuccessListener { token: StandardIntegrityToken ->
            promise.resolve(token.token())
          }
          .addOnFailureListener { e ->
            promise.reject("E_ATTEST", e.message ?: "integrity token request failed", e)
          }
      } catch (e: Exception) {
        promise.reject("E_ATTEST", e.message ?: "integrity token request failed", e)
      }
    }

    // No assertion concept on Android — Play Integrity issues a fresh token
    // per request, so attestKey() already covers the per-request case.
    AsyncFunction("generateAssertion") { _: String, _: String, promise: Promise ->
      promise.reject(
        "E_UNSUPPORTED",
        "generateAssertion is iOS-only; use attestKey() on Android",
        null
      )
    }
  }
}
