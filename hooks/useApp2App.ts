/**
 * ============================================================================
 * useApp2App — APP-TO-APP ONRAMP ORCHESTRATION HOOK
 * ============================================================================
 *
 * Drives the full app2app onramp hand-off against the CDP onramp-mobile APIs
 * (cdp-api PR #1278):
 *
 *   1. createOnrampMobileChallenge(params) → { challenge, expiresAt }
 *        Binds the transaction params server-side and returns the attestation
 *        challenge.
 *   2. getAppAttestation(challenge)   → device attestation/assertion (iOS App
 *                                       Attest / Android Play Integrity) signed
 *                                       over SHA-256(challenge).
 *   3. createOnrampMobileSession(...)  → { onrampUrl, sessionToken }
 *        Verifies the attestation and returns the onramp session (the id we
 *        pass to the deep link).
 *   4. openCoinbaseApp2App(session, …) → https://coinbase.com/onramp?… universal
 *        link carrying the session token.
 *
 * Mirrors the createOrder/createWidgetSession surface in useOnramp.ts so it can
 * be wired into the existing onramp form as a third payment path.
 * ============================================================================
 */

import { useCurrentUser } from "@coinbase/cdp-hooks";
import { useCallback, useState } from "react";
import { Platform } from "react-native";
import {
  attestDeviceKey,
  clearLegacyAppAttestKeys,
  getAppAttestation,
  isAppAttestSupported,
  isDeviceRegistered,
  markDeviceRegistered,
  resetAppAttestKey,
} from "../utils/appAttest";
import {
  createOnrampAttestationChallenge,
  createOnrampMobileChallenge,
  createOnrampMobileSession,
  registerOnrampAttestation,
  type App2AppOrderParams,
} from "../utils/createApp2AppSession";
import { openCoinbaseApp2App } from "../utils/openCoinbaseApp2App";
import { a2aLog, a2aWarn } from "../utils/app2appLog";
import { setCurrentPartnerUserRef } from "../utils/sharedState";

/** Inputs for a single app2app onramp, supplied by the form/caller. */
export interface StartApp2AppParams {
  purchaseCurrency: string;     // e.g. "USDC"
  destinationNetwork: string;   // e.g. "base"
  destinationAddress: string;   // wallet address (smart account for EVM)
  paymentAmount: string;        // e.g. "25.00"
  paymentCurrency: string;      // e.g. "USD"
}

const REDIRECT_URL = "onrampdemo://onramp-return";
// App Attest App ID in `teamID.bundleID` form. Configure via env — never hardcode
// a real team/bundle id in source (see .env.example: EXPO_PUBLIC_APP_ATTEST_APP_ID).
const APP_ATTEST_APP_ID = process.env.EXPO_PUBLIC_APP_ATTEST_APP_ID || "";
// The CDP project that owns this onramp integration. Required by the
// onramp-mobile challenge/registration endpoints. Falls back to the wallet
// project id when a dedicated onramp project isn't configured.
const ONRAMP_PROJECT_ID =
  process.env.EXPO_PUBLIC_ONRAMP_PROJECT_ID ||
  process.env.EXPO_PUBLIC_CDP_PROJECT_ID ||
  "";
// iOS bundle identifier — the App Attest App ID is `teamID.bundleID`, so the
// bundle id is everything after the leading team id.
const BUNDLE_ID = APP_ATTEST_APP_ID.includes(".")
  ? APP_ATTEST_APP_ID.split(".").slice(1).join(".")
  : APP_ATTEST_APP_ID;

/**
 * One-time, per-install iOS App Attest device-key registration (cdp-api
 * PR #1347). No-op on Android (Play Integrity is validated inline per request)
 * and when the device key is already registered. On the simulator / Expo Go the
 * attestation is a mock that won't verify upstream, so we skip the server call.
 *
 * If the server rejects the attestation we reset the key so the next attempt
 * provisions a fresh one (Apple only lets a key be attested once).
 */
async function ensureDeviceRegistered(): Promise<void> {
  if (Platform.OS !== "ios") return;
  // Purge pre-scoping keys once so a device previously used in another
  // environment (e.g. dev) doesn't carry a stale registration into this one.
  await clearLegacyAppAttestKeys();
  if (await isDeviceRegistered()) {
    a2aLog("🔐 [APP2APP] Device key already registered — skipping registration");
    return;
  }

  // 1. One-time registration challenge for this project.
  const { challenge } = await createOnrampAttestationChallenge(ONRAMP_PROJECT_ID);

  // 2. Attest the Secure Enclave key over SHA-256(base64url_decode(challenge)).
  const attestation = await attestDeviceKey(challenge);
  if (attestation.isMock) {
    a2aWarn(
      "⚠️ [APP2APP] Mock attestation (no Secure Enclave) — skipping upstream registration",
    );
    return;
  }

  // 3. Verify + register the device public key upstream.
  try {
    const registration = await registerOnrampAttestation({
      projectId: ONRAMP_PROJECT_ID,
      challenge,
      ios: {
        keyId: attestation.keyId,
        attestation: attestation.attestation,
        bundleId: BUNDLE_ID,
      },
    });
    await markDeviceRegistered(registration.keyId);
  } catch (e) {
    // A key can only be attested once; drop it so the next run starts fresh.
    await resetAppAttestKey();
    throw e;
  }
}

export function useApp2App() {
  const { currentUser } = useCurrentUser();
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Runs the full attest → session → cbpay flow.
   * @returns true if the Coinbase app was opened.
   */
  const startApp2App = useCallback(
    async (params: StartApp2AppParams): Promise<boolean> => {
      setIsProcessing(true);
      setError(null);
      try {
        const partnerUserRef = currentUser?.userId || "unknown-user";
        setCurrentPartnerUserRef(partnerUserRef);

        const supported = await isAppAttestSupported();
        if (!supported) {
          // Not fatal in the demo — getAppAttestation falls back to a mock when
          // there's no native module (Expo Go / web) or unsupported hardware.
          a2aWarn('⚠️ [APP2APP] Hardware attestation unavailable — using stub attestation');
        }

        // 0. One-time per-install device-key registration (iOS App Attest).
        //    Must precede the session so the device's public key is on file for
        //    the per-transaction assertion check.
        await ensureDeviceRegistered();

        // 1. Create the challenge + bind the transaction params server-side.
        const order: App2AppOrderParams = {
          projectId: ONRAMP_PROJECT_ID,
          appId: APP_ATTEST_APP_ID,
          purchaseCurrency: params.purchaseCurrency,
          destinationNetwork: params.destinationNetwork,
          destinationAddress: params.destinationAddress,
          paymentAmount: params.paymentAmount,
          paymentCurrency: params.paymentCurrency,
          partnerUserRef,
          redirectUrl: REDIRECT_URL,
        };
        const { challenge } = await createOnrampMobileChallenge(order);

        // 2. Per-transaction assertion bound to SHA-256(base64url_decode(challenge))
        //    (signed with the now-registered key).
        const attestation = await getAppAttestation(challenge);

        // 3. Verify the attestation → onramp session (the id for the deep link).
        const session = await createOnrampMobileSession({ challenge, attestation });

        // 4. Hand off to the Coinbase retail app via the onramp universal link,
        //    carrying the verified session token + the order details.
        return await openCoinbaseApp2App(session, {
          address: params.destinationAddress,
          asset: params.purchaseCurrency,
          presetFiatAmount: params.paymentAmount,
          defaultNetwork: params.destinationNetwork,
          redirectUrl: REDIRECT_URL,
        });
      } catch (e: any) {
        console.error('❌ [APP2APP] Flow failed:', e);
        setError(e?.message || 'App-to-app onramp failed');
        throw e;
      } finally {
        setIsProcessing(false);
      }
    },
    [currentUser],
  );

  return { startApp2App, isProcessing, error };
}
