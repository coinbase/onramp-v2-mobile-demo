import { BASE_URL } from "../constants/BASE_URL";
import { authenticatedFetch } from "./authenticatedFetch";

// Maps profile balance network name → Coinbase blockchain identifier
function toBlockchainId(network: string): string {
  switch (network.toLowerCase()) {
    case 'base': return 'base';
    case 'ethereum': return 'ethereum';
    case 'solana': return 'solana';
    default: return network.toLowerCase();
  }
}

/**
 * Creates an offramp session token via the backend proxy, then builds
 * and returns the full Coinbase-hosted offramp URL.
 *
 * The redirectUrl encodes the partnerUserRef so offramp-send.tsx can
 * fetch the transaction details after Coinbase redirects back to the app.
 *
 * @param address  - User's wallet address (smart account for EVM, solana address for SOL)
 * @param network  - Display network name: "Base" | "Ethereum" | "Solana"
 * @param asset    - Token symbol: "ETH" | "USDC" | "SOL" etc.
 * @param userId   - partnerUserRef (currentUser.userId)
 * @returns Full offramp URL to open in the system browser
 */
export async function createOfframpSession({
  address,
  network,
  asset,
  userId,
}: {
  address: string;
  network: string;
  asset: string;
  userId: string;
}): Promise<string> {
  const blockchain = toBlockchainId(network);

  console.log('📤 [OFFRAMP] Creating session token', { address, blockchain, asset, userId });

  // 1. Fetch a single-use session token from the backend proxy
  const tokenRes = await authenticatedFetch(`${BASE_URL}/server/api`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: 'https://api.developer.coinbase.com/onramp/v1/token',
      method: 'POST',
      body: {
        addresses: [{ address, blockchains: [blockchain] }],
      },
    }),
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.json().catch(() => null);
    throw new Error(err?.message || `Failed to create offramp session: ${tokenRes.status}`);
  }

  const tokenData = await tokenRes.json();
  console.log('✅ [OFFRAMP] Session token response:', JSON.stringify(tokenData));
  const token = tokenData.token;
  if (!token) {
    throw new Error(`No token in response: ${JSON.stringify(tokenData)}`);
  }

  // 2. Deep link redirectUrl — Coinbase calls this after the user clicks "Cash out now".
  const redirectUrl = `onrampdemo://offramp-send?partnerUserRef=${encodeURIComponent(userId)}`;

  // 3. addresses param: JSON map of address → blockchains (Coinbase URL convention)
  const addressesParam = JSON.stringify({ [address]: [blockchain] });

  const params = new URLSearchParams({
    sessionToken: token,
    partnerUserRef: userId,
    redirectUrl,
    addresses: addressesParam,
    defaultAsset: asset,
    defaultNetwork: blockchain,
  });

  const offrampUrl = `https://pay.coinbase.com/v3/sell/input?${params.toString()}`;
  console.log('🔗 [OFFRAMP] Full URL:', offrampUrl);

  return offrampUrl;
}
