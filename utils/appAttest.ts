/**
 * ============================================================================
 * APP ATTEST  —  cross-platform device attestation wrapper
 * ============================================================================
 *
 * Drives the device-attestation half of the app2app onramp. The attestation
 * object is the trust anchor for the *public* `createApp2AppSession` call — it
 * replaces the server-side CDP JWT used by the regular (private) onramp order
 * API.
 *
 * Platforms (see modules/app-attest):
 *   - iOS:     Apple App Attest  (DCAppAttestService)
 *   - Android: Play Integrity API (StandardIntegrityManager)
 *
 * Flow (per #proj-onramp-app-2-app — Aleksei Chernikov):
 *   1. generateKey()  — once per app install.
 *      iOS returns a Secure-Enclave keyId; Android warms up the Play Integrity
 *      token provider (no keyId). Apple RATE-LIMITS attestKey(), so the keyId
 *      is generated once and persisted, never per session.
 *   2. challenge/token — issued by onramp-service. That endpoint isn't built
 *      yet, so the demo uses a hardcoded constant (DEMO_CHALLENGE = "foobar")
 *      for downstream testing. Swap in requestApp2AppChallenge() when live.
 *   3. clientDataHash = SHA-256(base64url_decode(challenge));
 *      attestKey(keyId, clientDataHash) → attestation object (iOS CBOR /
 *      Android Play Integrity JWT). The challenge is unpadded base64url, so it
 *      is decoded to raw bytes BEFORE hashing (server contract); hashing the
 *      text instead yields reason=nonce_mismatch on the backend.
 *   4. The attestation object + keyId go to the backend, which validates it
 *      with Apple / Google.
 *
 * MOCK FALLBACK
 * --------------------------------------------------------------------------
 * The native module is only present in a dev/prod build (expo run:ios|android
 * or EAS). In Expo Go / web there is no native module, so we fall back to a
 * deterministic JS MOCK so the end-to-end flow stays exercisable. Mock
 * attestations are NOT verifiable upstream — the public session endpoint must
 * run in stub/sandbox mode to accept them.
 * ============================================================================
 */

import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import type {
  AppAttestNativeModule,
  AttestationProvider,
} from '../modules/app-attest';
import { a2aLog, a2aWarn } from './app2appLog';

/**
 * The demo challenge. onramp-service's challenge endpoint isn't implemented
 * yet, so per the spec we hardcode a constant and run the full downstream
 * flow against it. Replace with requestApp2AppChallenge() once live.
 */
export const DEMO_CHALLENGE = 'foobar';

/**
 * Lazily require the native module. requireNativeModule throws when the module
 * isn't linked (Expo Go / web), which is how we detect mock mode.
 */
let nativeModule: AppAttestNativeModule | null | undefined;
function getNativeModule(): AppAttestNativeModule | null {
  if (nativeModule !== undefined) return nativeModule;
  try {
    // Defer the import so the throw is contained to this try/catch.
    nativeModule = require('../modules/app-attest').default as AppAttestNativeModule;
  } catch {
    nativeModule = null;
  }
  return nativeModule;
}

// App Attest keys are bound to BOTH the CDP onramp project (the server registers
// the key per project) AND the Apple App Attest environment (development vs
// production) selected by the build's entitlement. A key provisioned under one
// (dev project + dev App Attest env) is meaningless to the other, so stored keys
// MUST NOT be shared across them: reusing a dev-registered key against prod makes
// the server skip registration and then reject the per-request assertion.
//
// Scope every stored value by the onramp project id (dev and prod use distinct
// projects, e.g. 46cdfdf1… vs 6d851850…) so each environment provisions,
// attests, and registers its own key independently on the same device. Switching
// envs no longer collides — it simply starts a fresh key.
const STORE_SCOPE = (
  process.env.EXPO_PUBLIC_ONRAMP_PROJECT_ID ||
  process.env.EXPO_PUBLIC_CDP_PROJECT_ID ||
  'default'
).replace(/[^A-Za-z0-9._-]/g, '');

const KEY_ID_STORE_KEY = `app2app.appAttest.keyId.${STORE_SCOPE}`;
// Marks that the stored keyId has already been through attestKey() once, so
// subsequent requests use generateAssertion() instead. Apple RATE-LIMITS
// attestKey() (once per key lifetime), so we must not re-attest per session.
const ATTESTED_STORE_KEY = `app2app.appAttest.attestedKeyId.${STORE_SCOPE}`;
// Marks that the keyId has been registered with onramp-service (cdp-api PR
// #1347) — i.e. the server verified the attestation and stored the public key.
// Set only after the registration endpoint returns success.
const REGISTERED_STORE_KEY = `app2app.appAttest.registeredKeyId.${STORE_SCOPE}`;

// Legacy (pre-scoping) store keys. Older builds persisted these fixed names with
// no environment scope, so a device previously used in dev carries a
// dev-registered key that a prod build would wrongly treat as already
// registered. clearLegacyAppAttestKeys() purges them once on app2app entry.
const LEGACY_STORE_KEYS = [
  'app2app.appAttest.keyId',
  'app2app.appAttest.attestedKeyId',
  'app2app.appAttest.registeredKeyId',
] as const;

/**
 * Whether the payload is the one-time attestation (key registration) or a
 * per-request assertion. iOS App Attest distinguishes these; Android Play
 * Integrity issues a fresh token per request, so it always reports 'attestation'.
 */
export type AppAttestationKind = 'attestation' | 'assertion';

export interface AppAttestation {
  /** keyId from generateKey() — empty on Android (Play Integrity has no keyId). */
  keyId: string;
  /** base64 attestation object / assertion (iOS CBOR) or Play Integrity JWT (Android). */
  attestationObject: string;
  /** Whether attestationObject is a one-time attestation or a per-request assertion. */
  kind: AppAttestationKind;
  /** The challenge the attestation was bound to (echoed back for the server). */
  challenge: string;
  /** Which attestation technology produced this object. */
  provider: AttestationProvider | 'mock';
  /** true when produced by the JS mock (no native module present). */
  isMock: boolean;
}

/** Returns a stable, persisted mock keyId for fallback (no native hardware). */
async function getOrCreateMockKeyId(): Promise<string> {
  const existing = await SecureStore.getItemAsync(KEY_ID_STORE_KEY).catch(() => null);
  if (existing) return existing;
  const keyId = `mock-key-${Crypto.randomUUID()}`;
  await SecureStore.setItemAsync(KEY_ID_STORE_KEY, keyId).catch(() => {});
  return keyId;
}

/** Whether real hardware device attestation is available on this device. */
export async function isAppAttestSupported(): Promise<boolean> {
  const native = getNativeModule();
  if (!native) return false;
  try {
    return await native.isSupported();
  } catch (e) {
    a2aWarn('⚠️ [APP ATTEST] isSupported() threw:', e);
    return false;
  }
}

/**
 * Returns the persisted attestation keyId, provisioning (and storing) one on
 * first use. App Attest keys are per-app-per-user and Apple rate-limits
 * attestKey(), so we generate a single key per install and reuse it.
 *
 * On Android there is no keyId; generateKey() warms up the Play Integrity
 * provider and this returns an empty string (still persisted as a "prepared"
 * marker so we can short-circuit, though the provider is re-prepared per run).
 */
export async function getOrCreateAppAttestKeyId(): Promise<string> {
  const native = getNativeModule();

  if (!native) {
    // MOCK: fabricate (and persist) a stable mock keyId.
    a2aWarn('⚠️ [APP ATTEST] Native module missing — using MOCK keyId');
    return getOrCreateMockKeyId();
  }

  // Android: no persistent keyId — always (re)prepare the provider. If Play
  // Integrity isn't configured (no cloudProjectNumber) or unavailable (e.g. a
  // sideloaded debug build), don't throw — return '' so getAppAttestation can
  // fall back to a mock attestation for the demo.
  if (native.provider === 'android-play-integrity') {
    a2aLog('🔑 [APP ATTEST] Preparing Play Integrity token provider…');
    try {
      return await native.generateKey();
    } catch (e) {
      a2aWarn('⚠️ [APP ATTEST] Play Integrity prepare failed — will use mock:', e);
      return '';
    }
  }

  // iOS: reuse the persisted Secure Enclave keyId if present.
  const existing = await SecureStore.getItemAsync(KEY_ID_STORE_KEY).catch(() => null);
  if (existing) {
    a2aLog('🔑 [APP ATTEST] Reusing stored keyId');
    return existing;
  }

  a2aLog('🔑 [APP ATTEST] Generating new Secure Enclave key…');
  const keyId = await native.generateKey();
  await SecureStore.setItemAsync(KEY_ID_STORE_KEY, keyId).catch((e) =>
    a2aWarn('⚠️ [APP ATTEST] Failed to persist keyId:', e),
  );
  return keyId;
}

/**
 * The one-time iOS App Attest attestation (key registration) payload, bound to
 * a registration challenge. Submitted to the onramp attestation registration
 * endpoint (cdp-api PR #1347). iOS-only.
 */
export interface DeviceAttestation {
  /** keyId from generateKey() (Secure Enclave). */
  keyId: string;
  /** base64 CBOR attestation object from attestKey(). */
  attestation: string;
  /** Which attestation technology produced this object. */
  provider: AttestationProvider | 'mock';
  /** true when produced by the JS mock (no native module / simulator). */
  isMock: boolean;
}

/** Whether the current keyId has been registered upstream (server-confirmed). */
export async function isDeviceRegistered(): Promise<boolean> {
  const native = getNativeModule();
  // Only iOS App Attest has a registration step; other paths are never "registered".
  if (!native || native.provider !== 'apple-app-attest') return false;
  const [keyId, registered] = await Promise.all([
    SecureStore.getItemAsync(KEY_ID_STORE_KEY).catch(() => null),
    SecureStore.getItemAsync(REGISTERED_STORE_KEY).catch(() => null),
  ]);
  return !!keyId && keyId === registered;
}

/**
 * Records that `keyId` has been registered with onramp-service. Also sets the
 * locally-attested marker so the per-transaction `getAppAttestation` path skips
 * attestKey() (Apple rate-limits it) and goes straight to generateAssertion().
 */
export async function markDeviceRegistered(keyId: string): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(REGISTERED_STORE_KEY, keyId).catch((e) =>
      a2aWarn('⚠️ [APP ATTEST] Failed to persist registered flag:', e),
    ),
    SecureStore.setItemAsync(ATTESTED_STORE_KEY, keyId).catch(() => {}),
  ]);
}

/**
 * Decodes an unpadded base64url string (RFC 4648 §5) into raw bytes. The onramp
 * attestation challenge is minted with Go's base64.RawURLEncoding (web-safe
 * `-`/`_`, no `=` padding), which the standard base64 decoders reject — so we
 * translate to standard base64 and re-pad before decoding.
 */
function base64UrlToBytes(b64url: string): Uint8Array {
  let b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4 !== 0) b64 += '=';
  const g = globalThis as any;
  if (typeof g.atob === 'function') {
    const bin = g.atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }
  if (typeof g.Buffer !== 'undefined') {
    return new Uint8Array(g.Buffer.from(b64, 'base64'));
  }
  throw new Error('No base64 decoder available to decode challenge');
}

/** Encodes raw bytes into a standard (padded) base64 string. */
function bytesToBase64(bytes: Uint8Array): string {
  const g = globalThis as any;
  if (typeof g.btoa === 'function') {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return g.btoa(bin);
  }
  if (typeof g.Buffer !== 'undefined') {
    return g.Buffer.from(bytes).toString('base64');
  }
  throw new Error('No base64 encoder available to encode clientDataHash');
}

/**
 * Computes the App Attest `clientDataHash` the way onramp-service verifies it:
 *
 *   clientDataHash = SHA-256( base64url_decode(challenge) )
 *
 * The challenge is issued as unpadded base64url, so it MUST be decoded to its
 * raw 32 bytes BEFORE hashing — hashing the base64url *text* yields a different
 * nonce and the server rejects it with `reason=nonce_mismatch`
 * (register_attestation_verify.go). Returned base64 for the native bridge.
 */
async function computeClientDataHashB64(challenge: string): Promise<string> {
  const challengeBytes = base64UrlToBytes(challenge);
  const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, challengeBytes);
  return bytesToBase64(new Uint8Array(digest));
}

/**
 * Produces the one-time iOS App Attest ATTESTATION (key registration) object,
 * bound to clientDataHash = SHA-256(base64url_decode(`challenge`)). This is the
 * registration counterpart to the per-request assertion produced by
 * `getAppAttestation`.
 *
 * iOS-only: calls DCAppAttestService.attestKey() exactly once for the key. On
 * the simulator / Expo Go (no Secure Enclave) it falls back to a clearly-fake
 * mock so the demo flow still runs (the mock won't verify upstream).
 */
export async function attestDeviceKey(challenge: string): Promise<DeviceAttestation> {
  if (!challenge) throw new Error('App Attest registration requires a challenge');

  const native = getNativeModule();
  const clientDataHashB64 = await computeClientDataHashB64(challenge);

  if (native && native.provider === 'apple-app-attest') {
    try {
      const keyId = await getOrCreateAppAttestKeyId();
      a2aLog('🛡️ [APP ATTEST] attestKey() — one-time device-key registration…');
      const attestation = await native.attestKey(keyId, clientDataHashB64);
      a2aLog(
        `✅ [APP ATTEST] Real Apple attestation GENERATED (keyId=${keyId.slice(0, 8)}…, bytes=${attestation.length})`,
      );
      return { keyId, attestation, provider: native.provider, isMock: false };
    } catch (e) {
      a2aWarn('⚠️ [APP ATTEST] attestKey() failed — falling back to mock:', e);
    }
  } else {
    a2aWarn('⚠️ [APP ATTEST] No Apple App Attest — returning MOCK attestation');
  }

  const mockKeyId = await getOrCreateMockKeyId();
  const mock = buildMockAttestation(mockKeyId, clientDataHashB64, challenge);
  return {
    keyId: mock.keyId,
    attestation: mock.attestationObject,
    provider: mock.provider,
    isMock: true,
  };
}

/**
 * Produces a device-attestation payload bound to `challenge`.
 *
 * iOS (App Attest) follows Apple's attest-once / assert-per-request model:
 *   - First call for a fresh key → attestKey() (one-time key registration).
 *   - Every subsequent call → generateAssertion() (cheap, not rate-limited).
 * The caller/server uses `kind` to know which it received.
 *
 * Android (Play Integrity) issues a fresh token per request, so it always
 * returns kind 'attestation'.
 *
 * @param challenge  the server-issued token/nonce. Defaults to DEMO_CHALLENGE
 *                   ("foobar") since the challenge endpoint isn't live yet.
 */
export async function getAppAttestation(
  challenge: string = DEMO_CHALLENGE,
): Promise<AppAttestation> {
  if (!challenge) throw new Error('App Attest requires a challenge');

  const native = getNativeModule();

  // clientDataHash = SHA-256(base64url_decode(challenge)), matching how
  // onramp-service recomputes the nonce for both registration and assertion.
  // (Decode the base64url challenge to raw bytes first — do NOT hash the text.)
  const clientDataHashB64 = await computeClientDataHashB64(challenge);

  if (native) {
    try {
      // Acquire the keyId INSIDE the try: on the iOS Simulator (no Secure
      // Enclave) generateKey() throws "App Attest is not supported on this
      // device", so this must fall back to the mock rather than escape the flow.
      const keyId = await getOrCreateAppAttestKeyId();

      // iOS App Attest: attest the key exactly once, then assert per request.
      if (native.provider === 'apple-app-attest') {
        const attestedKeyId = await SecureStore.getItemAsync(ATTESTED_STORE_KEY).catch(() => null);
        const alreadyAttested = attestedKeyId === keyId;

        if (!alreadyAttested) {
          a2aLog('🛡️ [APP ATTEST] First-time attestKey() (one-time key registration)…');
          const attestationObject = await native.attestKey(keyId, clientDataHashB64);
          await SecureStore.setItemAsync(ATTESTED_STORE_KEY, keyId).catch((e) =>
            a2aWarn('⚠️ [APP ATTEST] Failed to persist attested flag:', e),
          );
          a2aLog(
            `✅ [APP ATTEST] Real Apple App Attest GENERATED (kind=attestation, provider=${native.provider}, keyId=${keyId.slice(0, 8)}…, bytes=${attestationObject.length})`,
          );
          return {
            keyId,
            attestationObject,
            kind: 'attestation',
            challenge,
            provider: native.provider,
            isMock: false,
          };
        }

        a2aLog('✍️ [APP ATTEST] generateAssertion() (per-request, key already attested)…');
        const assertion = await native.generateAssertion(keyId, clientDataHashB64);
        a2aLog(
          `✅ [APP ATTEST] Real Apple App Attest GENERATED (kind=assertion, provider=${native.provider}, keyId=${keyId.slice(0, 8)}…, bytes=${assertion.length})`,
        );
        return {
          keyId,
          attestationObject: assertion,
          kind: 'assertion',
          challenge,
          provider: native.provider,
          isMock: false,
        };
      }

      // Android Play Integrity: fresh token per request.
      a2aLog(`🛡️ [APP ATTEST] Attesting via ${native.provider}…`);
      const attestationObject = await native.attestKey(keyId, clientDataHashB64);
      return {
        keyId,
        attestationObject,
        kind: 'attestation',
        challenge,
        provider: native.provider,
        isMock: false,
      };
    } catch (e) {
      // Real attestation can fail on the simulator (iOS) or on a sideloaded
      // build without Play Integrity config (Android). Fall back to the mock so
      // the demo flow still completes end-to-end.
      a2aWarn('⚠️ [APP ATTEST] Native attestation failed — falling back to mock:', e);
    }
  } else {
    a2aWarn('⚠️ [APP ATTEST] Native module missing — returning MOCK attestation');
  }

  // MOCK: deterministic, clearly-fake attestation object. Use a mock keyId since
  // the native key may be unavailable (e.g. on the simulator).
  const mockKeyId = await getOrCreateMockKeyId();
  return buildMockAttestation(mockKeyId, clientDataHashB64, challenge);
}

/** Builds a deterministic, clearly-fake attestation for demo/fallback use. */
function buildMockAttestation(
  keyId: string,
  clientDataHashB64: string,
  challenge: string,
): AppAttestation {
  const mockPayload = JSON.stringify({
    stub: 'app-attest',
    keyId,
    clientDataHash: clientDataHashB64,
    challenge,
    platform: Platform.OS,
  });
  let attestationObject: string;
  if (typeof (globalThis as any).btoa === 'function') {
    attestationObject = (globalThis as any).btoa(mockPayload);
  } else if (typeof (globalThis as any).Buffer !== 'undefined') {
    attestationObject = (globalThis as any).Buffer.from(mockPayload, 'utf8').toString('base64');
  } else {
    attestationObject = mockPayload;
  }

  return { keyId, attestationObject, kind: 'attestation', challenge, provider: 'mock', isMock: true };
}

/**
 * Clears the cached keyId AND the attested marker (e.g. on logout or to force a
 * fresh key + re-attestation on the next call).
 */
export async function resetAppAttestKey(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY_ID_STORE_KEY).catch(() => {});
  await SecureStore.deleteItemAsync(ATTESTED_STORE_KEY).catch(() => {});
  await SecureStore.deleteItemAsync(REGISTERED_STORE_KEY).catch(() => {});
}

/**
 * Deletes the pre-scoping (un-scoped) App Attest store entries left by older
 * builds. Without this, a device previously used in another environment (e.g.
 * dev) would carry a dev-registered key that a prod build wrongly treats as
 * already registered — skipping registration and then failing the assertion.
 * Idempotent/no-op once cleared; call once on the app2app entry path.
 */
export async function clearLegacyAppAttestKeys(): Promise<void> {
  await Promise.all(
    LEGACY_STORE_KEYS.map((k) => SecureStore.deleteItemAsync(k).catch(() => {})),
  );
}
