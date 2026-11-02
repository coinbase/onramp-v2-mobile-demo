/**
 * Maps known onramp-service error signatures in a thrown Error's message to a
 * friendlier, actionable string for the demo UI. Falls through to the raw
 * message when nothing matches, so this only adds clarity — it never hides
 * an error that isn't explicitly handled here.
 */
export function getFriendlyOnrampErrorMessage(rawMessage: string): string {
  const lower = rawMessage.toLowerCase();

  if (lower.includes('asset_not_tradable') || lower.includes('assetnottradable') || lower.includes('asset_not_tradeable')) {
    return `This asset isn't enabled for guest checkout on this app yet.\n\n` +
      `For internal testing: the asset must be added to the "guest-checkout-internal-only-assets" ` +
      `config list, AND this app's ID must be added to "guest-checkout-internal-only-assets-app-ids" ` +
      `in onramp-service config (platforms-shared-prod). Both are required — an asset can be staged ` +
      `without any app being allowlisted to use it.\n\n(${rawMessage})`;
  }

  return rawMessage;
}
