/**
 * ============================================================================
 * canOpenCoinbaseOnramp — TEMPORARY dual-scheme App2App detection shim
 * ============================================================================
 *
 * @coinbase/cdp-react-native@0.0.124's `canOpenCoinbaseOnramp()` only probes
 * the original `com.coinbase.cdp.onramp://` scheme. The Coinbase app is
 * introducing a versioned `com.coinbase.cdp.onramp.v2://` scheme so partner
 * apps can detect a build that supports newer App2App input-contract
 * capabilities — see coinbase.ghe.com/consumer/react-native/pull/83147.
 *
 * The SDK fix that probes both schemes (coinbase/cdp-web#592) hasn't merged
 * or published yet. Until this app bumps to whatever version ships that fix,
 * this wrapper covers the gap by calling the SDK's check *and* probing the
 * v2 scheme directly, treating either as available.
 *
 * DELETE THIS FILE once bumped past the cdp-web#592 release: replace both
 * call sites (`hooks/useCoinbaseAppInstalled.ts`,
 * `app/(tabs)/index.tsx`) with the SDK's `canOpenCoinbaseOnramp` directly.
 *
 * Both schemes must be declared in `LSApplicationQueriesSchemes`
 * (app.config.ts) — already done — or `canOpenURL` silently returns `false`
 * for the undeclared one regardless of what's installed.
 * ============================================================================
 */

import { canOpenCoinbaseOnramp as sdkCanOpenCoinbaseOnramp } from "@coinbase/cdp-react-native";
import { Linking, Platform } from "react-native";

export const COINBASE_ONRAMP_SCHEME_V2 = "com.coinbase.cdp.onramp.v2://";

export async function canOpenCoinbaseOnramp(): Promise<boolean> {
  if (Platform.OS !== "ios") return false;

  const [sdkResult, v2Result] = await Promise.all([
    sdkCanOpenCoinbaseOnramp().catch(() => false),
    Linking.canOpenURL(COINBASE_ONRAMP_SCHEME_V2).catch(() => false),
  ]);

  return sdkResult || v2Result;
}
