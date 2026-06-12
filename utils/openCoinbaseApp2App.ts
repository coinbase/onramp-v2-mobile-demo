import { Linking } from "react-native";
import type { App2AppSession } from "./createApp2AppSession";
import { a2aLog } from "./app2appLog";

/**
 * ============================================================================
 * COINBASE ONRAMP APP-TO-APP HAND-OFF
 * ============================================================================
 *
 * Opens the Coinbase onramp via a universal link of the shape:
 *
 *   https://www.coinbase.com/onramp?sessionToken=...&address=...&asset=USDC
 *     &presetFiatAmount=100&defaultNetwork=base&redirectUrl=onrampdemo://...
 *
 * On a device with the Coinbase app installed (and the universal-link
 * association for www.coinbase.com/onramp in place), iOS/Android route this
 * straight into the Coinbase app, which reads the session token + preset order
 * params and shows the onramp. When it finishes it returns to this app via
 * `redirectUrl`. If the Coinbase app isn't installed, the OS opens the same URL
 * on the web — a graceful fallback.
 *
 * The order params (address / asset / presetFiatAmount / defaultNetwork) come
 * from the same form + quote data used by fetchBuyQuote, passed through
 * useApp2App → here.
 * ============================================================================
 */

const COINBASE_ONRAMP_URL = "https://www.coinbase.com/onramp";

/** Onramp order params encoded into the universal link, from the form/quote. */
export interface App2AppHandoffParams {
  /** Destination wallet address (smart account for EVM). */
  address: string;
  /** Asset to purchase, e.g. "ETH" / "USDC". */
  asset: string;
  /** Preset fiat amount to buy, e.g. "100". */
  presetFiatAmount: string;
  /** Default network, e.g. "base". */
  defaultNetwork: string;
  /** Deep link the Coinbase app returns to when the flow completes. */
  redirectUrl: string;
}

/** Builds the `https://www.coinbase.com/onramp?...` universal link. */
export function buildApp2AppUrl(
  session: App2AppSession,
  params: App2AppHandoffParams,
): string {
  const query = new URLSearchParams({
    sessionToken: session.sessionToken,
    address: params.address,
    asset: params.asset,
    presetFiatAmount: params.presetFiatAmount,
    defaultNetwork: params.defaultNetwork,
    redirectUrl: params.redirectUrl,
  });
  return `${COINBASE_ONRAMP_URL}?${query.toString()}`;
}

/**
 * Opens the Coinbase onramp universal link for the app2app session.
 * @returns true if the URL was handed off to the OS, false on failure.
 */
export async function openCoinbaseApp2App(
  session: App2AppSession,
  params: App2AppHandoffParams,
): Promise<boolean> {
  const url = buildApp2AppUrl(session, params);
  a2aLog('🔗 [APP2APP] Opening Coinbase onramp:', url);

  try {
    // Universal link: opens the Coinbase app when installed (and the
    // www.coinbase.com/onramp association resolves), otherwise the OS opens the
    // same onramp URL on the web.
    await Linking.openURL(url);
    return true;
  } catch (e) {
    console.error('❌ [APP2APP] Failed to open Coinbase onramp URL:', e);
    return false;
  }
}
