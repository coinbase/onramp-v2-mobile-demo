/**
 * ============================================================================
 * useApp2App — APP-TO-APP ONRAMP ORCHESTRATION HOOK
 * ============================================================================
 *
 * Drives the full app-to-app onramp hand-off into the Coinbase retail app via
 * utils/app2AppOnramp.ts (hand-rolled — does not use @coinbase/cdp-react-native's
 * openCoinbaseOnramp(); calls @coinbase/cdp-app-attest directly and proxies all
 * network calls through our own backend's /app2app/mobile/* routes). That
 * module handles:
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

import { useCurrentUser } from "@coinbase/cdp-hooks";
import { useCallback, useState } from "react";

import { runApp2AppOnramp } from "../utils/app2AppOnramp";
import { getSandboxMode, setCurrentPartnerUserRef } from "../utils/sharedState";

/**
 * Exactly one of paymentAmount / purchaseAmount — mutually exclusive at the
 * type level (mirrors @coinbase/cdp-react-native's own OpenCoinbaseOnrampParams),
 * per onramp-service's mobile challenge contract:
 *   paymentAmount:  "I want to spend exactly $25"      (fee-inclusive quote)
 *   purchaseAmount: "I want to receive exactly 25 USDC" (fee-exclusive quote)
 */
type App2AppAmountParams =
  | { paymentAmount: string; purchaseAmount?: never }
  | { purchaseAmount: string; paymentAmount?: never };

/** Inputs for a single app2app onramp, supplied by the form/caller. */
export type StartApp2AppParams = App2AppAmountParams & {
  purchaseCurrency: string;     // e.g. "USDC"
  destinationNetwork: string;   // e.g. "base"
  destinationAddress: string;   // wallet address (smart account for EVM)
  paymentCurrency: string;      // e.g. "USD"
  /**
   * Preselects the payment instrument on the Coinbase-app handoff screen.
   * Optional — onramp-service's mobile challenge contract accepts it as one
   * of CARD | ACH | APPLE_PAY | PAYPAL | FIAT_WALLET | CRYPTO_WALLET, but
   * omitting it lets the user pick inside the Coinbase app as before.
   */
  paymentMethod?: string;
};

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
   *
   * When Sandbox Mode is on, partnerUserRef is prefixed with `sandbox-` so
   * ValidateOnrampSession returns dryRun=true and Retail skips real commit.
   */
  const startApp2App = useCallback(
    async (params: StartApp2AppParams): Promise<void> => {
      setIsProcessing(true);
      setError(null);
      try {
        const isSandbox = getSandboxMode();
        const userId = currentUser?.userId;
        const partnerUserRef = userId
          ? `${isSandbox ? "sandbox-" : ""}${userId}`
          : undefined;

        console.log("📱 [APP2APP] Starting onramp", {
          sandbox: isSandbox,
          partnerUserRef,
          paymentMethod: params.paymentMethod,
          paymentCurrency: params.paymentCurrency,
          paymentAmount: params.paymentAmount,
          purchaseAmount: params.purchaseAmount,
        });
        if (partnerUserRef) {
          setCurrentPartnerUserRef(partnerUserRef);
        }

        // Built as a single object per branch (not an inline ternary spread)
        // so it satisfies runApp2AppOnramp's discriminated union at compile
        // time — TS doesn't distribute a union cleanly through multiple
        // interleaved conditional spreads in one object literal.
        const commonParams = {
          projectId: ONRAMP_PROJECT_ID,
          destinationAddress: params.destinationAddress,
          destinationNetwork: params.destinationNetwork,
          purchaseCurrency: params.purchaseCurrency,
          paymentCurrency: params.paymentCurrency,
          ...(params.paymentMethod ? { paymentMethod: params.paymentMethod } : {}),
          redirectUrl: REDIRECT_URL,
          partnerUserRef,
          // Per cdp-api PR #1765, 2 of the 4 App2App calls now require a CDP
          // API-key JWT that can never live on-device — every call is proxied
          // through our own backend (which holds the key and forwards to CDP)
          // instead of straight to CDP.
          apiBaseUrl: process.env.EXPO_PUBLIC_BASE_URL || "",
        };

        if (params.purchaseAmount) {
          await runApp2AppOnramp({ ...commonParams, purchaseAmount: params.purchaseAmount });
        } else {
          // The StartApp2AppParams union guarantees paymentAmount is set here
          // (it's the only other variant), but TS's narrowing on a `?: never`
          // discriminant doesn't fully prove that back through the else branch.
          await runApp2AppOnramp({ ...commonParams, paymentAmount: params.paymentAmount! });
        }
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
