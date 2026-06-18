/**
 * ============================================================================
 * useCoinbaseAppInstalled — COINBASE RETAIL APP DETECTION
 * ============================================================================
 *
 * Detects whether the Coinbase retail (consumer) app is installed by probing
 * its registered URL scheme with Linking.canOpenURL. Partners (e.g. Phantom)
 * can branch their UX on this — app-to-app hand-off when installed, web/Widget
 * fallback when not.
 *
 * iOS REQUIREMENT: the probed scheme MUST be declared under
 * `LSApplicationQueriesSchemes` in the app's Info.plist (see app.config.ts and
 * ios/OnrampV2Demo/Info.plist). Without it, canOpenURL always resolves `false`
 * on iOS regardless of whether the app is installed.
 *
 * The check re-runs whenever the app returns to the foreground, so the UI stays
 * accurate if the user installs/removes Coinbase while this app is backgrounded.
 * ============================================================================
 */

import { useCallback, useEffect, useState } from "react";
import { AppState, Linking } from "react-native";

/**
 * URL scheme registered by the Coinbase retail app. Probing it tells us whether
 * the retail app is installed on the device.
 */
export const COINBASE_RETAIL_SCHEME = "com.coinbase.consumer://";

export type CoinbaseAppInstallState = "unknown" | "installed" | "not-installed";

export interface UseCoinbaseAppInstalledResult {
  /** Raw detection state; "unknown" until the first probe resolves. */
  state: CoinbaseAppInstallState;
  /** Convenience boolean — true only once the app is confirmed installed. */
  isInstalled: boolean;
  /** Re-run the detection on demand. */
  refresh: () => Promise<void>;
}

export function useCoinbaseAppInstalled(): UseCoinbaseAppInstalledResult {
  const [state, setState] = useState<CoinbaseAppInstallState>("unknown");

  const check = useCallback(async () => {
    try {
      const installed = await Linking.canOpenURL(COINBASE_RETAIL_SCHEME);
      setState(installed ? "installed" : "not-installed");
    } catch {
      // canOpenURL can throw if the scheme isn't whitelisted; treat as absent.
      setState("not-installed");
    }
  }, []);

  useEffect(() => {
    check();

    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") check();
    });
    return () => subscription.remove();
  }, [check]);

  return { state, isInstalled: state === "installed", refresh: check };
}
