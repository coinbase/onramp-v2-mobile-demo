/**
 * ============================================================================
 * app-attest — local Expo native module
 * ============================================================================
 *
 * Cross-platform device attestation for the app2app onramp flow:
 *   - iOS:     Apple App Attest  (DCAppAttestService, DeviceCheck framework)
 *   - Android: Play Integrity API (StandardIntegrityManager)
 *
 * The JS surface is intentionally small and platform-agnostic so the rest of
 * the app (utils/appAttest.ts) can drive both platforms with one code path.
 * Where the platforms diverge, the differences are documented per-method.
 *
 * Spec reference: #proj-onramp-app-2-app (Aleksei Chernikov's attestation flow).
 * ============================================================================
 */

import { requireNativeModule } from "expo-modules-core";

/** Which attestation technology produced an attestation object. */
export type AttestationProvider = "apple-app-attest" | "android-play-integrity";

export interface AppAttestNativeModule {
  /** The attestation provider for the current platform. */
  readonly provider: AttestationProvider;

  /**
   * Whether device attestation is available on this device.
   *  - iOS:     DCAppAttestService.isSupported (false on simulator / old HW)
   *  - Android: Play Integrity / Google Play services available
   */
  isSupported(): Promise<boolean>;

  /**
   * Provision the per-app attestation key.
   *  - iOS:     DCAppAttestService.generateKey() → keyId (base64). The private
   *             key never leaves the Secure Enclave; only the keyId is exposed.
   *             Apple rate-limits attestKey(), so generate once per install and
   *             persist the keyId (see utils/appAttest.ts).
   *  - Android: StandardIntegrityManager.prepareIntegrityToken() warms up the
   *             token provider. There is no Apple-style keyId; this resolves to
   *             an empty string and the provider is cached natively for request().
   */
  generateKey(): Promise<string>;

  /**
   * Produce an attestation bound to clientDataHash = SHA-256(challenge).
   *  - iOS:     DCAppAttestService.attestKey(keyId, clientDataHash) → base64
   *             CBOR attestation object.
   *  - Android: StandardIntegrityTokenProvider.request(requestHash) → the
   *             Play Integrity JWT. (keyId is ignored on Android.)
   *
   * @param keyId             keyId from generateKey() (iOS); ignored on Android.
   * @param clientDataHashB64 base64 of SHA-256(challenge).
   */
  attestKey(keyId: string, clientDataHashB64: string): Promise<string>;

  /**
   * iOS only — produce a per-assertion signature for an already-attested key
   * (DCAppAttestService.generateAssertion). Provided for the future
   * attest-once / assert-per-request model. Rejects on Android.
   */
  generateAssertion(keyId: string, clientDataHashB64: string): Promise<string>;
}

export default requireNativeModule<AppAttestNativeModule>("AppAttest");
