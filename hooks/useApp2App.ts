/**
 * ============================================================================
 * useApp2App — APP-TO-APP ONRAMP ORCHESTRATION HOOK
 * ============================================================================
 *
 * Drives the full app-to-app onramp hand-off into the Coinbase retail app
 * using the @coinbase/cdp-react-native SDK. The SDK handles:
 *
 *   Step 0 (once per install) — iOS device-key registration
 *   ─────────────────────────────────────────────────────────
 *   Ensures the device's App Attest key is registered with the CDP onramp
 *   backend. No-op on subsequent calls once registered.
 *
 *   Steps 1–4 (every call) — per-transaction handoff
 *   ───────────────────────────────────────────────────
 *   1. Creates a per-transaction challenge bound to the order parameters.
 *   2. Signs the challenge with the registered device key (iOS App Attest).
 *   3. Exchanges the assertion for an onramp session token.
 *   4. Opens https://www.coinbase.com/onramp?sessionToken=… via Universal
 *      Link. If the Coinbase app is installed, iOS routes directly into the
 *      app; otherwise the OS falls back to the web onramp.
 * ============================================================================
 */

import { openCoinbaseOnramp } from "@coinbase/cdp-react-native";
import { useCurrentUser } from "@coinbase/cdp-hooks";
import { useCallback, useState } from "react";

/** Inputs for a single app2app onramp, supplied by the form/caller. */
export interface StartApp2AppParams {
  purchaseCurrency: string;     // e.g. "USDC"
  destinationNetwork: string;   // e.g. "base"
  destinationAddress: string;   // wallet address (smart account for EVM)
  paymentAmount: string;        // e.g. "25.00"
  paymentCurrency: string;      // e.g. "USD"
}

// Return target the Coinbase app redirects to when the onramp completes.
//
// This must be (a) a host in the CDP project's redirect domain allowlist and
// (b) a domain whose AASA points back at this app (ios.associatedDomains) so
// the Universal Link re-opens us. Resolution order:
//   1. EXPO_PUBLIC_APP2APP_REDIRECT_URL — explicit override.
//   2. https origin of EXPO_PUBLIC_BASE_URL — when the API base IS the app domain.
//   3. custom scheme — local/non-https backends where Universal Links don't apply.
function computeRedirectUrl(): string {
  const override = process.env.EXPO_PUBLIC_APP2APP_REDIRECT_URL;
  if (override) return override;
  const base = process.env.EXPO_PUBLIC_BASE_URL || "";
  try {
    const u = new URL(base);
    if (u.protocol === "https:") {
      return `${u.protocol}//${u.host}/onramp-return`;
    }
  } catch {
    // fall through to custom scheme
  }
  return "onrampdemo://onramp-return";
}
const REDIRECT_URL = computeRedirectUrl();

// App Attest App ID in `teamID.bundleID` form — never hardcode a real value;
// configure via EXPO_PUBLIC_APP_ATTEST_APP_ID (see .env.example).
const APP_ATTEST_APP_ID = process.env.EXPO_PUBLIC_APP_ATTEST_APP_ID || "";

// CDP project that owns this onramp integration.
const ONRAMP_PROJECT_ID =
  process.env.EXPO_PUBLIC_ONRAMP_PROJECT_ID ||
  process.env.EXPO_PUBLIC_CDP_PROJECT_ID ||
  "";

export function useApp2App() {
  const { currentUser } = useCurrentUser();
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Runs the full app-to-app onramp flow via the CDP SDK.
   * Throws on failure; callers should catch and handle appropriately.
   */
  const startApp2App = useCallback(
    async (params: StartApp2AppParams): Promise<void> => {
      setIsProcessing(true);
      setError(null);
      try {
        await openCoinbaseOnramp({
          projectId: ONRAMP_PROJECT_ID,
          appAttestAppId: APP_ATTEST_APP_ID,
          destinationAddress: params.destinationAddress,
          destinationNetwork: params.destinationNetwork,
          purchaseCurrency: params.purchaseCurrency,
          paymentAmount: params.paymentAmount,
          paymentCurrency: params.paymentCurrency,
          redirectUrl: REDIRECT_URL,
          partnerUserRef: currentUser?.userId,
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
