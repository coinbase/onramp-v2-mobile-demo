/**
 * ============================================================================
 * useCoinbaseAppInstalled — CDP ONRAMP APP-TO-APP AVAILABILITY DETECTION
 * ============================================================================
 *
 * Detects whether the installed Coinbase app supports the CDP onramp
 * app-to-app handoff by probing the `com.coinbase.cdp.onramp://` scheme
 * (via `canOpenCoinbaseOnramp` from @coinbase/cdp-react-native).
 *
 * This is more precise than probing `com.coinbase.consumer://` — the CDP
 * onramp scheme is only registered by Coinbase app versions that correctly
 * handle the CDP session token. Older versions silently show an error screen.
 *
 * Platform requirements:
 *   iOS — `com.coinbase.cdp.onramp` under `LSApplicationQueriesSchemes`
 *         (see app.config.ts).
 *   Android — `<queries>` for the CDP onramp scheme / Coinbase package
 *         (see plugins/withApp2AppAndroid.js). Once the SDK enables Android
 *         `canOpenCoinbaseOnramp` (COM2-3685), this probe reflects install
 *         state; until then the SDK may report unavailable on Android.
 *
 * The check re-runs whenever the app returns to the foreground so the UI
 * stays accurate if the user installs/removes Coinbase while backgrounded.
 * ============================================================================
 */

import { canOpenCoinbaseOnramp } from "@coinbase/cdp-react-native";
import { useCallback, useEffect, useState } from "react";
import { AppState } from "react-native";

export type CoinbaseAppInstallState = "unknown" | "installed" | "not-installed";

export interface UseCoinbaseAppInstalledResult {
  /** Raw detection state; "unknown" until the first probe resolves. */
  state: CoinbaseAppInstallState;
  /** Convenience boolean — true only once the app is confirmed to support CDP onramp. */
  isInstalled: boolean;
  /** Re-run the detection on demand. */
  refresh: () => Promise<void>;
}

export function useCoinbaseAppInstalled(): UseCoinbaseAppInstalledResult {
  const [state, setState] = useState<CoinbaseAppInstallState>("unknown");

  const check = useCallback(async () => {
    try {
      const available = await canOpenCoinbaseOnramp();
      setState(available ? "installed" : "not-installed");
    } catch {
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
