import crypto from 'crypto';
import { z } from 'zod';

export const embeddedOrderInputSchema = z.object({
  paymentAmount: z.string().min(1),
  paymentCurrency: z.string().min(1),
  purchaseCurrency: z.string().min(1),
  destinationNetwork: z.string().min(1),
  destinationAddress: z.string().min(1),
  sandbox: z.boolean(),
  isQuote: z.boolean().optional().default(false),
  // A dogfooding control: the device may opt out of replaying a token, but it
  // can never supply a token itself.
  reuseUserAuthToken: z.boolean().optional().default(true),
  locale: z.string().optional(),
}).passthrough();

export type EmbeddedOrderInput = z.output<typeof embeddedOrderInputSchema>;

export function embeddedAuthTokenKey(userId: string, destinationNetwork: string, destinationAddress: string, environment: string): string {
  const hash = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
  return `embedded-auth-token:v1:${environment.toLowerCase()}:${hash(userId)}:${destinationNetwork.toLowerCase()}:${hash(destinationAddress.trim().toLowerCase())}`;
}

/** Builds the sole payload sent to CDP for an Embedded Order. */
export function buildEmbeddedOrderPayload(
  input: EmbeddedOrderInput,
  userId: string,
  clientIp: string,
  userAuthToken?: string,
) {
  const partnerUserRef = `${input.sandbox ? 'sandbox-' : ''}${userId}`;
  return {
    paymentAmount: input.paymentAmount,
    paymentCurrency: input.paymentCurrency,
    purchaseCurrency: input.purchaseCurrency,
    destinationNetwork: input.destinationNetwork,
    destinationAddress: input.destinationAddress,
    paymentMethod: 'GUEST_CHECKOUT_APPLE_PAY',
    partnerUserRef,
    isQuote: input.isQuote,
    clientIp,
    ...(input.locale ? { locale: input.locale } : {}),
    ...(!input.isQuote && userAuthToken ? { userAuthToken } : {}),
  };
}
