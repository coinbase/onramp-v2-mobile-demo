/**
 * AD HOC — temporary fork of `@coinbase/cdp-react-native`'s openCoinbaseOnramp
 * that registers App Attest keys via:
 *
 *   POST /v2/onramp/mobile/projects/{projectId}/attestation/registrations
 *
 * with `keyId` only in the JSON body (ios.keyId). The published SDK (0.0.116)
 * still uses the legacy PUT .../registrations/{keyId} path.
 *
 * Remove this file and switch `useApp2App` back to `openCoinbaseOnramp` once
 * the SDK ships the POST registration change (cdp-web changeset).
 */

import { Platform, Linking } from "react-native";

const DEFAULT_CDP_API_BASE_URL = "https://api.cdp.coinbase.com/platform";

export interface OpenCoinbaseOnrampPostParams {
  projectId: string;
  destinationAddress: string;
  destinationNetwork: string;
  purchaseCurrency: string;
  paymentAmount: string;
  paymentCurrency: string;
  redirectUrl: string;
  partnerUserRef?: string;
  /** Defaults to production CDP API. */
  apiBaseUrl?: string;
}

interface IosAttestationPayload {
  keyId: string;
  attestation: string;
  bundleId: string;
}

interface OnrampAttestationRegistration {
  appId: string;
  keyId: string;
  platform: string;
  attestedAt: string;
}

interface App2AppChallengeParams {
  projectId: string;
  purchaseCurrency: string;
  destinationNetwork: string;
  destinationAddress: string;
  redirectUrl: string;
  paymentAmount: string;
  paymentCurrency: string;
  partnerUserRef?: string;
}

async function request<T>(
  apiBaseUrl: string,
  path: string,
  method: "POST" | "PUT",
  body?: object,
): Promise<T> {
  const url = `${apiBaseUrl}${path}`;
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  if (!res.ok) {
    type ErrorBody = {
      errorMessage?: string;
      message?: string;
      error?: string;
      errorType?: string;
    };
    const raw = await res.text().catch(() => "");
    let errBody: ErrorBody | null = null;
    try {
      errBody = raw ? (JSON.parse(raw) as ErrorBody) : null;
    } catch {
      errBody = null;
    }
    const message =
      errBody?.errorMessage ||
      errBody?.message ||
      errBody?.error ||
      (raw.trim() ? raw.trim() : `HTTP ${res.status}`);
    const type = errBody?.errorType ? `${errBody.errorType}: ` : "";
    throw new Error(`${type}${message} (${method} ${path} → ${res.status})`);
  }

  const data: unknown = await res.json();
  if (data === null || typeof data !== "object") {
    throw new Error(
      `Unexpected response shape from ${path}: expected an object, got ${JSON.stringify(data)}`,
    );
  }
  return data as T;
}

async function createOnrampAttestationChallenge(
  projectId: string,
  apiBaseUrl: string,
): Promise<{ challenge: string; expiresAt: string }> {
  const data = await request<{ challenge?: string; expiresAt?: string }>(
    apiBaseUrl,
    `/v2/onramp/mobile/projects/${encodeURIComponent(projectId)}/attestation/challenges`,
    "POST",
  );
  if (!data.challenge) {
    throw new Error("CDP returned no challenge for attestation registration");
  }
  return { challenge: data.challenge, expiresAt: data.expiresAt ?? "" };
}

/**
 * Registers the device public key via POST (keyId in body only).
 * This is the only intentional difference from the published SDK.
 */
export async function registerOnrampAttestationPost(
  args: {
    projectId: string;
    challenge: string;
    ios: IosAttestationPayload;
  },
  apiBaseUrl: string,
): Promise<OnrampAttestationRegistration> {
  const { projectId, challenge, ios } = args;
  const path = `/v2/onramp/mobile/projects/${encodeURIComponent(projectId)}/attestation/registrations`;
  console.log(`📡 [APP2APP-ADHOC] POST ${path} (keyId in body only)`);
  const data = await request<OnrampAttestationRegistration>(
    apiBaseUrl,
    path,
    "POST",
    { challenge, ios },
  );
  if (!data.appId || !data.keyId) {
    throw new Error(`Unexpected onramp registration response: ${JSON.stringify(data)}`);
  }
  console.log(`✅ [APP2APP-ADHOC] Registered keyId=${data.keyId} appId=${data.appId}`);
  return data;
}

async function createOnrampMobileChallenge(
  params: App2AppChallengeParams,
  apiBaseUrl: string,
): Promise<{ challenge: string }> {
  const data = await request<{ challenge?: string }>(
    apiBaseUrl,
    "/v2/onramp/mobile/challenges",
    "POST",
    params,
  );
  if (!data.challenge) {
    throw new Error("CDP returned no challenge for mobile session");
  }
  return { challenge: data.challenge };
}

function extractSessionToken(onrampUrl: string): string {
  try {
    const token = new URL(onrampUrl).searchParams.get("sessionToken");
    if (token) return token;
  } catch {
    // fall through
  }
  const match = onrampUrl.match(/[?&]sessionToken=([^&#]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

async function createOnrampMobileSession(
  args: {
    challenge: string;
    ios: { keyId: string; assertion: string };
  },
  apiBaseUrl: string,
): Promise<{ onrampUrl: string; sessionToken: string }> {
  const data = await request<{ session?: { onrampUrl?: string } }>(
    apiBaseUrl,
    "/v2/onramp/mobile/sessions",
    "POST",
    args,
  );
  const onrampUrl = data?.session?.onrampUrl;
  if (!onrampUrl) {
    throw new Error(`CDP returned no onrampUrl in session response: ${JSON.stringify(data)}`);
  }
  const sessionToken = extractSessionToken(onrampUrl);
  if (!sessionToken) {
    throw new Error(`Could not extract sessionToken from onrampUrl: ${onrampUrl}`);
  }
  return { onrampUrl, sessionToken };
}

function base64urlToBase64(value: string): string {
  let b64 = value.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4 !== 0) b64 += "=";
  return b64;
}

function isAttestationKeyError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err ?? "")).toLowerCase();
  return /invalid.*key|device.*key|key\s*not\s*found|key.*unregist|public\s*key|invalidkey|key.*not.*register|device.*not.*register|attestation signature|signature could not be verified|assertion.*verif/.test(
    msg,
  );
}

function isStaleAttestationError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err ?? "")).toLowerCase();
  return msg.includes("stale_attestation") || msg.includes("attestation is too old");
}

async function loadAppAttestModule(): Promise<typeof import("@coinbase/cdp-app-attest")> {
  try {
    return await import("@coinbase/cdp-app-attest");
  } catch (cause) {
    throw new Error(
      "openCoinbaseOnrampPost requires @coinbase/cdp-app-attest. " +
        "Add it to your project: npm install @coinbase/cdp-app-attest",
      { cause },
    );
  }
}

async function ensureOnrampDeviceRegistered(
  projectId: string,
  apiBaseUrl: string,
  attest: (typeof import("@coinbase/cdp-app-attest"))["attest"],
  getOnrampRegisteredKeyId: (typeof import("@coinbase/cdp-app-attest"))["getOnrampRegisteredKeyId"],
  confirmOnrampRegistration: (typeof import("@coinbase/cdp-app-attest"))["confirmOnrampRegistration"],
  clearOnrampAttestation: (typeof import("@coinbase/cdp-app-attest"))["clearOnrampAttestation"],
): Promise<void> {
  const existingKeyId = await getOnrampRegisteredKeyId(projectId);
  if (existingKeyId) {
    console.log(`⏭️  [APP2APP-ADHOC] Already registered (keyId=${existingKeyId}); skipping POST`);
    return;
  }

  console.log("🔑 [APP2APP-ADHOC] Device not registered — running attest → POST register");
  const { challenge } = await createOnrampAttestationChallenge(projectId, apiBaseUrl);
  const attestationResult = await attest(base64urlToBase64(challenge));

  if (!attestationResult.ios) {
    throw new Error("App Attest produced no iOS attestation data");
  }

  try {
    const registration = await registerOnrampAttestationPost(
      {
        projectId,
        challenge,
        ios: {
          keyId: attestationResult.ios.keyId,
          attestation: attestationResult.ios.attestation,
          bundleId: attestationResult.ios.bundleId,
        },
      },
      apiBaseUrl,
    );
    await confirmOnrampRegistration(projectId, registration.keyId);
  } catch (e) {
    await clearOnrampAttestation(projectId);
    throw e;
  }
}

let _isOnrampInProgress = false;

/**
 * Same flow as SDK `openCoinbaseOnramp`, but device registration uses POST.
 */
export async function openCoinbaseOnrampPost(
  params: OpenCoinbaseOnrampPostParams,
): Promise<void> {
  if (Platform.OS !== "ios") {
    throw new Error("openCoinbaseOnrampPost is only supported on iOS");
  }

  if (_isOnrampInProgress) {
    throw new Error(
      "An onramp flow is already in progress. Wait for it to complete before starting another.",
    );
  }
  _isOnrampInProgress = true;

  try {
    await runOnrampPost(params);
  } finally {
    _isOnrampInProgress = false;
  }
}

async function runOnrampPost(params: OpenCoinbaseOnrampPostParams): Promise<void> {
  const {
    projectId,
    destinationAddress,
    destinationNetwork,
    purchaseCurrency,
    paymentAmount,
    paymentCurrency,
    redirectUrl,
    partnerUserRef,
    apiBaseUrl = DEFAULT_CDP_API_BASE_URL,
  } = params;

  const {
    isSupported,
    attest,
    createAssertion,
    getOnrampRegisteredKeyId,
    confirmOnrampRegistration,
    clearOnrampAttestation,
  } = await loadAppAttestModule();

  const supported = await isSupported();
  if (!supported) {
    throw new Error(
      "App Attest is not supported on this device. " +
        "openCoinbaseOnrampPost requires iOS 14+ running on a device with Secure Enclave.",
    );
  }

  const orderParams: App2AppChallengeParams = {
    projectId,
    purchaseCurrency,
    destinationNetwork,
    destinationAddress,
    redirectUrl,
    paymentAmount,
    paymentCurrency,
    ...(partnerUserRef ? { partnerUserRef } : {}),
  };

  const runHandoff = async (): Promise<void> => {
    const { challenge } = await createOnrampMobileChallenge(orderParams, apiBaseUrl);
    const assertionResult = await createAssertion(base64urlToBase64(challenge));

    if (!assertionResult.ios) {
      throw new Error("App Attest produced no iOS assertion data");
    }

    const session = await createOnrampMobileSession(
      {
        challenge,
        ios: {
          keyId: assertionResult.ios.keyId,
          assertion: assertionResult.ios.assertion,
        },
      },
      apiBaseUrl,
    );

    const url = new URL(session.onrampUrl);
    url.searchParams.set("address", destinationAddress);
    url.searchParams.set("asset", purchaseCurrency);
    url.searchParams.set("presetFiatAmount", paymentAmount);
    url.searchParams.set("defaultNetwork", destinationNetwork);
    url.searchParams.set("redirectUrl", redirectUrl);

    await Linking.openURL(url.toString());
  };

  const runHandoffWithStaleRetry = async (): Promise<void> => {
    try {
      await runHandoff();
    } catch (err) {
      if (!isStaleAttestationError(err)) {
        throw err;
      }
      await runHandoff();
    }
  };

  await ensureOnrampDeviceRegistered(
    projectId,
    apiBaseUrl,
    attest,
    getOnrampRegisteredKeyId,
    confirmOnrampRegistration,
    clearOnrampAttestation,
  );

  try {
    await runHandoffWithStaleRetry();
  } catch (err) {
    if (isAttestationKeyError(err)) {
      await clearOnrampAttestation(projectId);
      await ensureOnrampDeviceRegistered(
        projectId,
        apiBaseUrl,
        attest,
        getOnrampRegisteredKeyId,
        confirmOnrampRegistration,
        clearOnrampAttestation,
      );
      try {
        await runHandoffWithStaleRetry();
      } catch (retryErr) {
        const originalMsg = err instanceof Error ? err.message : String(err);
        const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
        throw new Error(
          `Onramp handoff failed after key reset. Original error: ${originalMsg}. Retry error: ${retryMsg}`,
        );
      }
      return;
    }
    throw err;
  }
}
