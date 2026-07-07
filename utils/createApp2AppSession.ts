import { Platform } from "react-native";
import { BASE_URL } from "../constants/BASE_URL";
import type { AppAttestation } from "./appAttest";
import { a2aLog } from "./app2appLog";

/**
 * ============================================================================
 * APP-TO-APP ONRAMP  —  CDP MOBILE SESSION CLIENT (PUBLIC)
 * ============================================================================
 *
 * Implements the public 2-step app2app handoff from cdp-api PR #1278
 * (c3/cdp-api → /v2/onramp/mobile/*). It is the app2app analogue of the create
 * onramp order API, but PUBLIC: instead of a server-side CDP JWT, each request
 * is trusted via a platform attestation (iOS App Attest / Android Play
 * Integrity) signed over a server-issued challenge.
 *
 *   1. createOnrampMobileChallenge(params)
 *        → { challenge, expiresAt }
 *        Binds the transaction params (amount, asset, network, destination,
 *        redirectUrl) server-side; the returned opaque `challenge` doubles as
 *        the attestation challenge.
 *   2. getAppAttestation(challenge)            (see utils/appAttest.ts)
 *        → iOS assertion / Android Play Integrity token over SHA-256(challenge)
 *   3. createOnrampMobileSession({ challenge, attestation })
 *        → { onrampUrl, sessionToken }
 *        Verifies the attestation and returns a ready-to-use onramp URL with
 *        the session token embedded. We surface that token so it can be passed
 *        to the Coinbase retail app via the deep link
 *        (see utils/openCoinbaseApp2App.ts).
 *
 * These calls use plain `fetch` (NOT authenticatedFetch) and hit the public
 * proxy routes on our server, which forward to the unauthenticated CDP
 * endpoints:
 *   POST /app2app/mobile/challenges → .../v2/onramp/mobile/challenges
 *   POST /app2app/mobile/sessions   → .../v2/onramp/mobile/sessions
 * ============================================================================
 */

/**
 * Challenge request params — mirrors CDP `OnrampSessionRequest` with the
 * `redirectUrl` that this endpoint requires. Only `destinationAddress`,
 * `purchaseCurrency`, `destinationNetwork` and `redirectUrl` are required; the
 * pricing inputs are optional and, when provided, cause the session response to
 * include a `quote`.
 */
export interface App2AppOrderParams {
  /**
   * The CDP Project ID that owns this onramp integration. Required by the
   * onramp-mobile endpoints to resolve the project's allowed mobile clients and
   * redirect-domain allowlist.
   */
  projectId: string;
  /**
   * iOS App Attest App ID in `teamID.bundleID` form
   * (e.g. "TEAMID.com.your.bundle"). NOTE: not part of the public
   * OpenAPI schema for this endpoint — sent at the backend's request so it can
   * resolve/allow-list the partner app for the App2App handoff.
   */
  appId: string;
  purchaseCurrency: string;        // e.g. "USDC"
  destinationNetwork: string;      // e.g. "base"
  destinationAddress: string;      // wallet address (smart account for EVM)
  /** Where the Coinbase app returns the user after the flow. Required here. */
  redirectUrl: string;
  paymentAmount?: string;          // fiat in, fee-inclusive quote (e.g. "25.00")
  purchaseAmount?: string;         // crypto out, fee-exclusive quote
  paymentCurrency?: string;        // e.g. "USD"
  paymentMethod?: string;          // CDP OnrampQuotePaymentMethodTypeId, e.g. "CARD"
  country?: string;                // ISO 3166-1 (e.g. "US")
  subdivision?: string;            // ISO 3166-2 (e.g. "NY"); required for US
  partnerUserRef?: string;         // for transaction tracking / webhooks
}

/** Step-1 response: opaque challenge token + expiry. */
export interface App2AppChallenge {
  /** Opaque, single-use token. Pass back verbatim — do not decode/modify. */
  challenge: string;
  /** ISO-8601 timestamp after which the challenge is no longer valid. */
  expiresAt: string;
}

/** iOS App Attest assertion payload (CDP `IosAssertionPayload`). */
export interface IosAssertionPayload {
  keyId: string;
  assertion: string;
}

/**
 * iOS App Attest attestation payload (CDP `IosAttestationPayload`) — used for
 * the one-time device-key registration (cdp-api PR #1347). Distinct from the
 * per-request `IosAssertionPayload`: this carries the CBOR attestation object
 * from `DCAppAttestService.attestKey()`, not a per-request assertion.
 */
export interface IosAttestationPayload {
  keyId: string;
  /** base64 CBOR attestation object from attestKey(). */
  attestation: string;
  /** iOS bundle identifier of the app (e.g. "com.your.bundle"). */
  bundleId: string;
}

/**
 * Result of registering a device key (CDP `OnrampAttestationRegistration`).
 * Returned once the server has verified the Apple attestation and stored the
 * device's public key for future assertion validation.
 */
export interface OnrampAttestationRegistration {
  /** The matched `teamID.bundleID` allowlist entry the device registered under. */
  appId: string;
  /** The registered App Attest key id — reused for subsequent assertions. */
  keyId: string;
  /** Always "ios" — registration is iOS-only. */
  platform: 'ios';
  /** ISO-8601 timestamp when the attestation was verified. */
  attestedAt: string;
}

/** Android Play Integrity payload (CDP `AndroidIntegrityPayload`). */
export interface AndroidIntegrityPayload {
  integrityToken: string;
}

/** Step-2 result: the onramp URL and the session token extracted from it. */
export interface App2AppSession {
  /** Ready-to-use onramp URL returned by CDP (embeds the session token). */
  onrampUrl: string;
  /**
   * The session id/token parsed out of `onrampUrl`. This is the value handed to
   * the Coinbase retail app via the deep link query param.
   */
  sessionToken: string;
}

/**
 * Step 1 — create the challenge and bind the transaction params. Public: no
 * Authorization header.
 */
export async function createOnrampMobileChallenge(
  params: App2AppOrderParams,
): Promise<App2AppChallenge> {
  a2aLog('📤 [APP2APP] createOnrampMobileChallenge', {
    appId: params.appId,
    purchaseCurrency: params.purchaseCurrency,
    destinationNetwork: params.destinationNetwork,
    paymentAmount: params.paymentAmount,
  });

  const res = await fetch(`${BASE_URL}/app2app/mobile/challenges`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });

  a2aLog('📥 [APP2APP] challenge status:', res.status, res.statusText);

  if (!res.ok) {
    throw new Error(await readApiError(res, 'Failed to create onramp mobile challenge'));
  }

  const data = await res.json();
  if (!data?.challenge) {
    throw new Error(`No challenge in response: ${JSON.stringify(data)}`);
  }
  return data as App2AppChallenge;
}

/**
 * ============================================================================
 * ONE-TIME iOS DEVICE-KEY REGISTRATION (cdp-api PR #1347)
 * ============================================================================
 * Before a device can sign per-transaction assertions, its App Attest key must
 * be registered once per install:
 *
 *   1. createOnrampAttestationChallenge(projectId)  → { challenge, expiresAt }
 *   2. attestDeviceKey(challenge)         (see utils/appAttest.ts)
 *        → CBOR attestation object over SHA-256(challenge)
 *   3. registerOnrampAttestation({ projectId, challenge, ios })
 *        → { appId, keyId, … } — device public key now stored upstream
 *
 * Both endpoints are public/unauthenticated and reached via the server proxy.
 * Per onramp-service PR #1840 (cdp-api v1.41.0 strict handlers), projectId and
 * keyId are PATH parameters, and registration is a PUT keyed on keyId:
 *   POST /app2app/mobile/projects/{projectId}/attestation/challenges
 *        → …/v2/onramp/mobile/projects/{projectId}/attestation/challenges
 *   PUT  /app2app/mobile/projects/{projectId}/attestation/registrations/{keyId}
 *        → …/v2/onramp/mobile/projects/{projectId}/attestation/registrations/{keyId}
 * ============================================================================
 */

/**
 * Registration step 1 — issue a one-time iOS App Attest registration challenge
 * for `projectId`. Distinct from `createOnrampMobileChallenge`, which issues the
 * per-transaction session challenge.
 */
export async function createOnrampAttestationChallenge(
  projectId: string,
): Promise<App2AppChallenge> {
  a2aLog('📤 [APP2APP] createOnrampAttestationChallenge', { projectId });

  // projectId is a path parameter (uuid-validated upstream); no request body.
  const res = await fetch(
    `${BASE_URL}/app2app/mobile/projects/${encodeURIComponent(projectId)}/attestation/challenges`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    },
  );

  a2aLog('📥 [APP2APP] attestation challenge status:', res.status, res.statusText);

  if (!res.ok) {
    throw new Error(await readApiError(res, 'Failed to create onramp attestation challenge'));
  }

  const data = await res.json();
  if (!data?.challenge) {
    throw new Error(`No challenge in attestation challenge response: ${JSON.stringify(data)}`);
  }
  return data as App2AppChallenge;
}

/**
 * Registration step 2 — verify the Apple attestation and register the device's
 * public key. iOS-only. Returns the matched allowlist `appId` and the
 * registered `keyId` to reuse for subsequent assertions.
 *
 * Per onramp-service PR #1840, this is a PUT with `projectId` and `keyId` as
 * path parameters; the body carries only the challenge and the attestation
 * material (`attestation`, `bundleId`).
 */
export async function registerOnrampAttestation(args: {
  projectId: string;
  challenge: string;
  ios: IosAttestationPayload;
}): Promise<OnrampAttestationRegistration> {
  const { projectId, challenge, ios } = args;
  const { keyId, attestation, bundleId } = ios;

  a2aLog('📤 [APP2APP] registerOnrampAttestation', {
    projectId,
    keyId: keyId?.slice(0, 8),
    bundleId,
  });

  // keyId is the authoritative device-key id in the path; it is also included in
  // the body's `ios` payload to match the cdp-api IosAttestationPayload schema
  // (attestation, bundleId, keyId) that the generated SDK sends.
  const res = await fetch(
    `${BASE_URL}/app2app/mobile/projects/${encodeURIComponent(projectId)}/attestation/registrations/${encodeURIComponent(keyId)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ challenge, ios: { keyId, attestation, bundleId } }),
    },
  );

  a2aLog('📥 [APP2APP] attestation registration status:', res.status, res.statusText);

  if (!res.ok) {
    throw new Error(await readApiError(res, 'Failed to register onramp attestation'));
  }

  const data = await res.json();
  if (!data?.appId || !data?.keyId) {
    throw new Error(`Unexpected registration response: ${JSON.stringify(data)}`);
  }
  a2aLog('✅ [APP2APP] device registered:', data.appId);
  return data as OnrampAttestationRegistration;
}

/**
 * Maps a device attestation produced by `getAppAttestation` to the platform
 * payload expected by the CDP mobile session endpoint (exactly one of
 * `ios` / `android`).
 */
export function attestationToPlatformPayload(
  attestation: AppAttestation,
): { ios?: IosAssertionPayload } | { android?: AndroidIntegrityPayload } {
  const isAndroid =
    attestation.provider === 'android-play-integrity' ||
    (attestation.isMock && Platform.OS === 'android');

  if (isAndroid) {
    return { android: { integrityToken: attestation.attestationObject } };
  }
  // iOS App Attest (and mock-on-iOS): the session endpoint verifies the
  // assertion signed over SHA-256(challenge) against the registered key.
  return {
    ios: { keyId: attestation.keyId, assertion: attestation.attestationObject },
  };
}

/**
 * Step 2 — verify the attestation and create the onramp session. Returns the
 * onramp URL plus the session token extracted from it. Public: trusted via the
 * attestation, not a secret.
 */
export async function createOnrampMobileSession(args: {
  challenge: string;
  attestation: AppAttestation;
}): Promise<App2AppSession> {
  const { challenge, attestation } = args;

  a2aLog('📤 [APP2APP] createOnrampMobileSession', {
    provider: attestation.provider,
    isMock: attestation.isMock,
  });

  const body = { challenge, ...attestationToPlatformPayload(attestation) };

  const res = await fetch(`${BASE_URL}/app2app/mobile/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  a2aLog('📥 [APP2APP] session status:', res.status, res.statusText);

  if (!res.ok) {
    throw new Error(await readApiError(res, 'Failed to create onramp mobile session'));
  }

  const data = await res.json();
  const onrampUrl: string | undefined = data?.session?.onrampUrl;
  if (!onrampUrl) {
    throw new Error(`No session.onrampUrl in response: ${JSON.stringify(data)}`);
  }

  const sessionToken = extractSessionToken(onrampUrl);
  if (!sessionToken) {
    throw new Error(`Could not extract sessionToken from onrampUrl: ${onrampUrl}`);
  }

  a2aLog('✅ [APP2APP] session created');
  return { onrampUrl, sessionToken };
}

/**
 * Pulls the `sessionToken` query param out of the CDP onramp URL
 * (e.g. https://pay.coinbase.com/buy?sessionToken=abc123). Falls back to a
 * regex if the URL implementation can't parse it.
 */
function extractSessionToken(onrampUrl: string): string {
  try {
    const token = new URL(onrampUrl).searchParams.get('sessionToken');
    if (token) return token;
  } catch {
    // Fall through to regex below.
  }
  const match = onrampUrl.match(/[?&]sessionToken=([^&#]+)/);
  return match ? decodeURIComponent(match[1]) : '';
}

/** Builds a human-readable error string from a CDP error response. */
async function readApiError(res: Response, fallback: string): Promise<string> {
  const data = await res.json().catch(() => null);
  if (data?.errorMessage) {
    return data.errorType ? `${data.errorType}: ${data.errorMessage}` : data.errorMessage;
  }
  return data?.message || data?.error || `${fallback} (HTTP ${res.status})`;
}
