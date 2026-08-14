import { BASE_URL } from "../constants/BASE_URL";
import { authenticatedFetch } from "./authenticatedFetch";

export type EmbeddedOrderRequest = {
  paymentAmount: string;
  paymentCurrency: string;
  purchaseCurrency: string;
  destinationNetwork: string;
  destinationAddress: string;
  sandbox: boolean;
  isQuote: boolean;
};

/**
 * Creates (or quotes) an Embedded Onramp Order.
 *
 * Contact fields and userAuthToken deliberately never cross the device boundary:
 * the backend derives the authenticated user reference, omits contacts so the
 * hosted experience owns verification, and stores token reuse server-side.
 */
export async function createEmbeddedOrder(payload: EmbeddedOrderRequest) {
  const response = await authenticatedFetch(`${BASE_URL}/onramp/order/embedded`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = data?.errorMessage || data?.error || data?.message;
    throw new Error(detail || `HTTP error! status: ${response.status}`);
  }

  return {
    ...data,
    hostedUrl: data?.paymentLink?.url as string | undefined,
    orderId: data?.order?.orderId as string | undefined,
  };
}
