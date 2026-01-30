/**
 * ============================================================================
 * SUPPORT EMAIL UTILITY - FAILED TRANSACTION SUPPORT
 * ============================================================================
 *
 * Generates a mailto: URL with pre-populated debug information for support.
 * When users encounter a failed transaction, they can click to open their
 * email client with all necessary debug info auto-filled.
 *
 * Email format matches Coinbase support requirements.
 *
 * Debug Info Format (from Coinbase Support):
 * --- Debug Information (please do not edit) ---
 * flowType: guest
 * appId: <CDP Project ID>
 * partnerName: <App Name>
 * deviceId: <Device Identifier>
 * guestEntityHash: <Unique Session Hash>
 * guestAmount: <Amount>
 * guestCurrency: <Currency>
 * appVersion: <App Version>
 * timestamp: <ISO Timestamp>
 * locale: <User Locale>
 * timezone: <User Timezone>
 * errorMessage: <Error Details>
 * debugMessage: <Additional Debug Info>
 * ---
 *
 * @see https://docs.cdp.coinbase.com/onramp-&-offramp/onramp-apis/transaction-status
 */

import * as Application from 'expo-application';
import * as Localization from 'expo-localization';
import { Linking, Platform } from 'react-native';
import { getCurrentPartnerUserRef, getCountry, getSandboxMode } from './sharedState';

// Support email - not exposed in UI, only used internally for mailto
const SUPPORT_EMAIL = 'onrampsupport@coinbase.com';
const PARTNER_NAME = 'Onramp V2 Demo';

export interface TransactionDebugInfo {
  // From transaction data
  transactionId?: string;
  status?: string;
  purchaseCurrency?: string;
  purchaseNetwork?: string;
  purchaseAmount?: string;
  paymentTotal?: string;
  paymentCurrency?: string;
  paymentMethod?: string;
  walletAddress?: string;
  txHash?: string;
  createdAt?: string;

  // From app context
  partnerUserRef?: string;
  errorMessage?: string;
  debugMessage?: string;
}

export interface GuestCheckoutDebugInfo {
  // For guest checkout errors (no transaction yet)
  flowType: 'guest' | 'authenticated';
  appId?: string;
  partnerName: string;
  deviceId?: string;
  guestEntityHash?: string;
  guestTransactionIdAtCreate?: string;
  guestAsset?: string;
  guestNetwork?: string;
  guestAmount?: string;
  guestCurrency?: string;
  guestPaymentMethod?: string;
  errorMessage?: string;
  debugMessage?: string;
}

/**
 * Generates a unique device ID for support tracking
 * Uses a combination of app install ID and timestamp for uniqueness
 */
function generateDeviceId(): string {
  // Format: random hex string similar to Phantom Wallet example
  const chars = '0123456789abcdef';
  let result = '';
  for (let i = 0; i < 32; i++) {
    if (i === 8 || i === 12 || i === 16 || i === 20) {
      result += '-';
    }
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

/**
 * Generates a unique entity hash for the support request
 * This helps Coinbase support track the specific session/request
 */
function generateSimpleEntityHash(): string {
  const partnerRef = getCurrentPartnerUserRef() || '';
  const timestamp = Date.now().toString(16);
  const random = Math.random().toString(16).substring(2, 10);
  return `${partnerRef.slice(0, 8)}${timestamp}${random}`.replace(/-/g, '');
}

/**
 * Builds debug information block for email body
 * Matches the exact format required by Coinbase support
 *
 * Format:
 * --- Debug Information (please do not edit) ---
 * flowType: guest
 * appId: <project-id>
 * partnerName: <app-name>
 * deviceId: <device-id>
 * guestEntityHash: <hash>
 * guestAmount: <amount>
 * guestCurrency: <currency>
 * appVersion: <version>
 * timestamp: <iso-timestamp>
 * locale: <locale>
 * timezone: <timezone>
 * errorMessage: <error>
 * debugMessage: <debug>
 * ---
 */
function buildDebugBlock(info: TransactionDebugInfo | GuestCheckoutDebugInfo): string {
  const timestamp = new Date().toISOString();
  const locale = Localization.locale || 'en-US';
  const timezone = Localization.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const appVersion = Application.nativeApplicationVersion || 'unknown';
  const appId = process.env.EXPO_PUBLIC_CDP_PROJECT_ID || 'unknown';
  const sandboxMode = getSandboxMode();

  const lines: string[] = [
    '--- Debug Information (please do not edit) ---',
  ];

  // Check if it's a GuestCheckoutDebugInfo (has flowType)
  if ('flowType' in info) {
    const guestInfo = info as GuestCheckoutDebugInfo;

    // Core identification fields (in exact order from Coinbase)
    lines.push(`flowType: ${guestInfo.flowType}`);
    lines.push(`appId: ${guestInfo.appId || appId}`);
    lines.push(`partnerName: ${guestInfo.partnerName || PARTNER_NAME}`);
    lines.push(`deviceId: ${guestInfo.deviceId || generateDeviceId()}`);
    lines.push(`guestEntityHash: ${guestInfo.guestEntityHash || generateSimpleEntityHash()}`);

    // Transaction details - always include guestAmount and guestCurrency per Coinbase format
    lines.push(`guestAmount: ${guestInfo.guestAmount || '0'}`);
    lines.push(`guestCurrency: ${guestInfo.guestCurrency || 'USD'}`);
    if (guestInfo.guestAsset) lines.push(`guestAsset: ${guestInfo.guestAsset}`);
    if (guestInfo.guestNetwork) lines.push(`guestNetwork: ${guestInfo.guestNetwork}`);
    if (guestInfo.guestPaymentMethod) lines.push(`guestPaymentMethod: ${guestInfo.guestPaymentMethod}`);
    if (guestInfo.guestTransactionIdAtCreate) lines.push(`guestTransactionIdAtCreate: ${guestInfo.guestTransactionIdAtCreate}`);
  } else {
    // TransactionDebugInfo - for completed/failed transactions
    const txInfo = info as TransactionDebugInfo;

    // Use 'authenticated' flow type for transaction-based requests
    lines.push(`flowType: authenticated`);
    lines.push(`appId: ${appId}`);
    lines.push(`partnerName: ${PARTNER_NAME}`);
    lines.push(`deviceId: ${generateDeviceId()}`);

    // Transaction-specific fields
    if (txInfo.transactionId) lines.push(`transactionId: ${txInfo.transactionId}`);
    if (txInfo.status) lines.push(`status: ${txInfo.status}`);
    if (txInfo.purchaseCurrency) lines.push(`purchaseCurrency: ${txInfo.purchaseCurrency}`);
    if (txInfo.purchaseNetwork) lines.push(`purchaseNetwork: ${txInfo.purchaseNetwork}`);
    if (txInfo.purchaseAmount) lines.push(`purchaseAmount: ${txInfo.purchaseAmount}`);
    if (txInfo.paymentTotal) lines.push(`paymentTotal: ${txInfo.paymentTotal}`);
    if (txInfo.paymentCurrency) lines.push(`paymentCurrency: ${txInfo.paymentCurrency}`);
    if (txInfo.paymentMethod) lines.push(`paymentMethod: ${txInfo.paymentMethod}`);
    if (txInfo.walletAddress) lines.push(`walletAddress: ${txInfo.walletAddress}`);
    if (txInfo.txHash) lines.push(`txHash: ${txInfo.txHash}`);
    if (txInfo.createdAt) lines.push(`createdAt: ${txInfo.createdAt}`);
    if (txInfo.partnerUserRef) lines.push(`partnerUserRef: ${txInfo.partnerUserRef}`);
  }

  // Common fields (in exact order from Coinbase)
  lines.push(`appVersion: ${appVersion}`);
  lines.push(`timestamp: ${timestamp}`);
  lines.push(`locale: ${locale}`);
  lines.push(`timezone: ${timezone}`);
  if (sandboxMode) lines.push(`environment: sandbox`);

  // Error information (at the end)
  const errorMessage = 'errorMessage' in info ? info.errorMessage : undefined;
  const debugMessage = 'debugMessage' in info ? info.debugMessage : undefined;

  if (errorMessage) lines.push(`errorMessage: ${errorMessage}`);
  if (debugMessage) lines.push(`debugMessage: ${debugMessage}`);

  lines.push('---');

  return lines.join('\n');
}

/**
 * Generates a unique reference ID for the support request
 * Uses partnerUserRef or generates a hash from available info
 */
function generateEntityHash(info: TransactionDebugInfo | GuestCheckoutDebugInfo): string {
  if ('guestEntityHash' in info && info.guestEntityHash) {
    return info.guestEntityHash;
  }

  if ('transactionId' in info && info.transactionId) {
    return info.transactionId;
  }

  const partnerRef = getCurrentPartnerUserRef();
  if (partnerRef) {
    // Create a simple hash-like string from partnerUserRef + timestamp
    const timestamp = Date.now().toString(36);
    return `${partnerRef.slice(0, 8)}-${timestamp}`;
  }

  // Fallback: generate a random ID
  return Math.random().toString(36).substring(2, 15);
}

/**
 * Opens email client with pre-populated support request
 *
 * @param info - Debug information to include in email
 * @returns Promise<boolean> - true if email client opened successfully
 */
export async function openSupportEmail(
  info: TransactionDebugInfo | GuestCheckoutDebugInfo
): Promise<boolean> {
  const entityHash = generateEntityHash(info);
  const subject = `Guest Checkout Support Request [${entityHash}]`;

  const body = `[Please describe your issue here]\n\n${buildDebugBlock(info)}`;

  // Encode for mailto URL
  const encodedSubject = encodeURIComponent(subject);
  const encodedBody = encodeURIComponent(body);

  const mailtoUrl = `mailto:${SUPPORT_EMAIL}?subject=${encodedSubject}&body=${encodedBody}`;

  try {
    const canOpen = await Linking.canOpenURL(mailtoUrl);
    if (!canOpen) {
      console.warn('Cannot open mailto URL - no email client configured');
      return false;
    }

    await Linking.openURL(mailtoUrl);
    return true;
  } catch (error) {
    console.error('Failed to open support email:', error);
    return false;
  }
}

/**
 * Creates TransactionDebugInfo from a transaction object (from history API)
 */
export function createDebugInfoFromTransaction(transaction: {
  transaction_id?: string;
  status?: string;
  purchase_currency?: string;
  purchase_network?: string;
  purchase_amount?: { value?: string; currency?: string } | string;
  payment_total?: { value?: string; currency?: string };
  payment_method?: string;
  wallet_address?: string;
  tx_hash?: string;
  created_at?: string;
  partner_user_ref?: string;
}, errorMessage?: string): TransactionDebugInfo {
  return {
    transactionId: transaction.transaction_id,
    status: transaction.status,
    purchaseCurrency: transaction.purchase_currency,
    purchaseNetwork: transaction.purchase_network,
    purchaseAmount: typeof transaction.purchase_amount === 'object'
      ? transaction.purchase_amount?.value
      : transaction.purchase_amount,
    paymentTotal: transaction.payment_total?.value,
    paymentCurrency: transaction.payment_total?.currency,
    paymentMethod: transaction.payment_method,
    walletAddress: transaction.wallet_address,
    txHash: transaction.tx_hash,
    createdAt: transaction.created_at,
    partnerUserRef: transaction.partner_user_ref || getCurrentPartnerUserRef() || undefined,
    errorMessage,
  };
}

/**
 * Creates GuestCheckoutDebugInfo for errors during checkout flow
 * (before a transaction is created)
 */
export function createGuestCheckoutDebugInfo(params: {
  asset?: string;
  network?: string;
  amount?: string;
  currency?: string;
  paymentMethod?: string;
  errorMessage?: string;
  debugMessage?: string;
}): GuestCheckoutDebugInfo {
  const partnerUserRef = getCurrentPartnerUserRef();

  return {
    flowType: 'guest',
    partnerName: 'Onramp V2 Demo',
    guestEntityHash: partnerUserRef ? `${partnerUserRef.slice(0, 20)}${Date.now().toString(36)}` : undefined,
    guestAsset: params.asset,
    guestNetwork: params.network,
    guestAmount: params.amount,
    guestCurrency: params.currency,
    guestPaymentMethod: params.paymentMethod,
    errorMessage: params.errorMessage,
    debugMessage: params.debugMessage,
  };
}

export { SUPPORT_EMAIL };
