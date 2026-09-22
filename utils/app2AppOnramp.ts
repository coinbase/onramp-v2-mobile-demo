/**
 * ============================================================================
 * app2AppOnramp — hand-rolled App2App orchestration (no @coinbase/cdp-react-native)
 * ============================================================================
 *
 * Ports @coinbase/cdp-react-native's openCoinbaseOnramp() orchestration (read
 * from its unminified source) so we control both the network calls (proxied
 * through our own backend's /app2app/mobile/* routes — see server/src/app.ts)
 * and the on-device App Attest calls (@coinbase/cdp-app-attest, used directly
 * here). This lets our backend use clean routes matching cdp-api's current
 * contract, with no legacy path-param shapes to shim around.
 * ============================================================================
 */

import { Linking, Platform } from "react-native";

type App2AppAmountParams =
  | { paymentAmount: string; purchaseAmount?: never }
  | { purchaseAmount: string; paymentAmount?: never };

export type App2AppOnrampParams = App2AppAmountParams & {
  projectId: string;
  destinationAddress: string;
  destinationNetwork: string;
  purchaseCurrency: string;
  paymentCurrency: string;
  paymentMethod?: string;
  redirectUrl: string;
  partnerUserRef?: string;
  apiBaseUrl: string;
};

// Only one physical App Attest ceremony can run at a time; module-level so it
// survives across component remounts (mirrors openCoinbaseOnramp()'s guard).
let isInProgress = false;

/**
 * Converts a base64url string (RFC 4648 §5, no padding) to standard base64.
 * CDP challenges are minted with Go's base64.RawURLEncoding (`-`/`_`, no `=`).
 * The @coinbase/cdp-app-attest native module expects standard base64 input.
 */
function base64urlToBase64(b64url: string): string {
  let b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4 !== 0) b64 += "=";
  return b64;
}

function isAttestationKeyError(err: unknown): boolean {
  const message = (err instanceof Error ? err.message : String(err ?? "")).toLowerCase();
  return /invalid.*key|device.*key|key\s*not\s*found|key.*unregist|public\s*key|invalidkey|key.*not.*register|device.*not.*register|attestation signature|signature could not be verified|assertion.*verif/.test(
    message,
  );
}

function isStaleAttestationError(err: unknown): boolean {
  const message = (err instanceof Error ? err.message : String(err ?? "")).toLowerCase();
  return message.includes("stale_attestation") || message.includes("attestation is too old");
}

async function postJson<T = unknown>(apiBaseUrl: string, path: string, body?: unknown): Promise<T> {
  const url = `${apiBaseUrl}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  const text = await res.text().catch(() => "");
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!res.ok) {
    const message =
      data?.errorMessage || data?.message || data?.error || (text.trim() ? text.trim() : `HTTP ${res.status}`);
    const prefix = data?.errorType ? `${data.errorType}: ` : "";
    throw new Error(`${prefix}${message} (POST ${path} → ${res.status})`);
  }
  if (data === null || typeof data !== "object") {
    throw new Error(`Unexpected response shape from ${path}: expected an object, got ${JSON.stringify(data)}`);
  }
  return data as T;
}

async function createOnrampAttestationChallenge(apiBaseUrl: string): Promise<{ challenge: string }> {
  const res = await postJson<{ challenge?: string }>(apiBaseUrl, "/app2app/mobile/attestation/challenges");
  if (!res.challenge) throw new Error("Backend returned no challenge for attestation registration");
  return res as { challenge: string };
}

async function registerOnrampAttestation(
  apiBaseUrl: string,
  body: { challenge: string; ios: { keyId: string; attestation: string; bundleId: string } },
): Promise<{ appId: string; keyId: string }> {
  const res = await postJson<{ appId?: string; keyId?: string }>(
    apiBaseUrl,
    "/app2app/mobile/attestation/registrations",
    body,
  );
  if (!res.appId || !res.keyId) {
    throw new Error(`Unexpected onramp registration response: ${JSON.stringify(res)}`);
  }
  return res as { appId: string; keyId: string };
}

async function createOnrampMobileChallenge(apiBaseUrl: string, body: unknown): Promise<{ challenge: string }> {
  const res = await postJson<{ challenge?: string }>(apiBaseUrl, "/app2app/mobile/challenges", body);
  if (!res.challenge) throw new Error("Backend returned no challenge for mobile session");
  return res as { challenge: string };
}

function extractSessionToken(onrampUrl: string): string {
  try {
    const token = new URL(onrampUrl).searchParams.get("sessionToken");
    if (token) return token;
  } catch {
    // fall through to regex extraction
  }
  const match = onrampUrl.match(/[?&]sessionToken=([^&#]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

async function createOnrampMobileSession(
  apiBaseUrl: string,
  body: { challenge: string; ios: { keyId: string; assertion: string } },
): Promise<{ onrampUrl: string; sessionToken: string }> {
  const res = await postJson<{ session?: { onrampUrl?: string } }>(apiBaseUrl, "/app2app/mobile/sessions", body);
  const onrampUrl = res?.session?.onrampUrl;
  if (!onrampUrl) throw new Error(`Backend returned no onrampUrl in session response: ${JSON.stringify(res)}`);
  const sessionToken = extractSessionToken(onrampUrl);
  if (!sessionToken) throw new Error(`Could not extract sessionToken from onrampUrl: ${onrampUrl}`);
  return { onrampUrl, sessionToken };
}

async function ensureAttestationRegistered(projectId: string, apiBaseUrl: string): Promise<void> {
  const { attest, getOnrampRegisteredKeyId, confirmOnrampRegistration, clearOnrampAttestation } = await import(
    "@coinbase/cdp-app-attest"
  );

  if (await getOnrampRegisteredKeyId(projectId)) return;

  const { challenge } = await createOnrampAttestationChallenge(apiBaseUrl);
  const attestation = await attest(base64urlToBase64(challenge));
  if (!attestation.ios) throw new Error("App Attest produced no iOS attestation data");

  try {
    const { keyId } = await registerOnrampAttestation(apiBaseUrl, {
      challenge,
      ios: {
        keyId: attestation.ios.keyId,
        attestation: attestation.ios.attestation,
        bundleId: attestation.ios.bundleId,
      },
    });
    await confirmOnrampRegistration(projectId, keyId);
  } catch (err) {
    await clearOnrampAttestation(projectId);
    throw err;
  }
}

async function runApp2AppOnrampInternal(params: App2AppOnrampParams): Promise<void> {
  const {
    projectId,
    destinationAddress,
    destinationNetwork,
    purchaseCurrency,
    paymentAmount,
    purchaseAmount,
    paymentCurrency,
    paymentMethod,
    redirectUrl,
    partnerUserRef,
    apiBaseUrl,
  } = params;

  const { isSupported, createAssertion, clearOnrampAttestation } = await import("@coinbase/cdp-app-attest");

  if (!(await isSupported())) {
    throw new Error(
      "App Attest is not supported on this device. App2App onramp requires iOS 14+ running on a device with Secure Enclave.",
    );
  }

  const challengeBody = {
    purchaseCurrency,
    destinationNetwork,
    destinationAddress,
    redirectUrl,
    paymentCurrency,
    // Mutually exclusive: validated in runApp2AppOnramp before this runs.
    ...(purchaseAmount ? { purchaseAmount } : { paymentAmount }),
    ...(paymentMethod ? { paymentMethod } : {}),
    ...(partnerUserRef ? { partnerUserRef } : {}),
  };

  const attemptHandoff = async () => {
    const { challenge } = await createOnrampMobileChallenge(apiBaseUrl, challengeBody);
    const assertion = await createAssertion(base64urlToBase64(challenge));
    if (!assertion.ios) throw new Error("App Attest produced no iOS assertion data");
    const session = await createOnrampMobileSession(apiBaseUrl, {
      challenge,
      ios: { keyId: assertion.ios.keyId, assertion: assertion.ios.assertion },
    });
    await Linking.openURL(session.onrampUrl);
  };

  const attemptHandoffWithStaleRetry = async () => {
    try {
      await attemptHandoff();
    } catch (err) {
      if (!isStaleAttestationError(err)) throw err;
      await attemptHandoff();
    }
  };

  await ensureAttestationRegistered(projectId, apiBaseUrl);

  try {
    await attemptHandoffWithStaleRetry();
  } catch (err) {
    if (!isAttestationKeyError(err)) throw err;

    await clearOnrampAttestation(projectId);
    await ensureAttestationRegistered(projectId, apiBaseUrl);
    try {
      await attemptHandoffWithStaleRetry();
    } catch (retryErr) {
      const originalMessage = err instanceof Error ? err.message : String(err);
      const retryMessage = retryErr instanceof Error ? retryErr.message : String(retryErr);
      throw new Error(
        `Onramp handoff failed after key reset. Original error: ${originalMessage}. Retry error: ${retryMessage}`,
      );
    }
  }
}

/** Runs the full app-to-app onramp flow: attestation registration (once per
 * device install) + per-transaction challenge/assertion/session handoff. */
export async function runApp2AppOnramp(params: App2AppOnrampParams): Promise<void> {
  if (Platform.OS !== "ios") {
    throw new Error("App2App onramp is only supported on iOS");
  }
  if (params.paymentAmount && params.purchaseAmount) {
    throw new Error("Provide only one of paymentAmount or purchaseAmount, not both");
  }
  if (!params.paymentAmount && !params.purchaseAmount) {
    throw new Error("Provide either paymentAmount or purchaseAmount");
  }
  if (isInProgress) {
    throw new Error("An onramp flow is already in progress. Wait for it to complete before starting another.");
  }

  isInProgress = true;
  try {
    await runApp2AppOnrampInternal(params);
  } finally {
    isInProgress = false;
  }
}
