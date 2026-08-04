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
 *   backend. No-op on subsequent calls once registered. Android skips this
 *   step — Play Integrity tokens are minted per request (no key registration).
 *
 *   Steps 1–4 (every call) — per-transaction handoff
 *   ───────────────────────────────────────────────────
 *   1. Creates a per-transaction challenge bound to the order parameters.
 *   2. Proves device integrity:
 *        iOS     — App Attest assertion over the challenge
 *        Android — Play Integrity token (requestHash derived from sessionToken;
 *                  see COM2-3685)
 *   3. Exchanges the proof for an onramp session / redirect URL.
 *   4. Opens the Coinbase onramp hand-off URL. When the Coinbase app is
 *      installed, the OS routes into retail; otherwise iOS may fall back to
 *      the web onramp.
 *
 * Requires a published SDK build with Android Play Integrity support
 * (COM2-3685). Until that lands, openCoinbaseOnramp throws on Android.
 * ============================================================================
 */

import { openCoinbaseOnramp } from "@coinbase/cdp-react-native";
import { useCurrentUser } from "@coinbase/cdp-hooks";
import { useCallback, useState } from "react";
import { getSandboxMode } from "../utils/sharedState";

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
// (b) a domain whose AASA / Digital Asset Links point back at this app
// (ios.associatedDomains / android.intentFilters) so the OS re-opens us.
// Resolution order:
//   1. EXPO_PUBLIC_APP2APP_REDIRECT_URL — explicit override.
//   2. https origin of EXPO_PUBLIC_BASE_URL — when the API base IS the app domain.
//   3. custom scheme — local/non-https backends where App Links don't apply.
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
        // Sandbox dry-run: prefix partnerUserRef the same way guest-checkout /
        // widget paths do so App2App sessions stay consistent across platforms.
        const userId = currentUser?.userId;
        const partnerUserRef = userId
          ? `${getSandboxMode() ? "sandbox-" : ""}${userId}`
          : undefined;

        await openCoinbaseOnramp({
          projectId: ONRAMP_PROJECT_ID,
          destinationAddress: params.destinationAddress,
          destinationNetwork: params.destinationNetwork,
          purchaseCurrency: params.purchaseCurrency,
          paymentAmount: params.paymentAmount,
          paymentCurrency: params.paymentCurrency,
          redirectUrl: REDIRECT_URL,
          partnerUserRef,
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
