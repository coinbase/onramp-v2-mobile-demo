import assert from 'node:assert/strict';
import test from 'node:test';
import { buildEmbeddedOrderPayload, embeddedAuthTokenKey, embeddedOrderInputSchema } from './embeddedOrder.js';

const input = embeddedOrderInputSchema.parse({
  paymentAmount: '2.00',
  paymentCurrency: 'USD',
  purchaseCurrency: 'USDC',
  destinationNetwork: 'base',
  destinationAddress: '0x1111111111111111111111111111111111111111',
  sandbox: true,
  isQuote: false,
  // These must be ignored rather than changing this into the standard flow.
  phoneNumber: '+12025550123',
  email: 'user@example.com',
  agreementAcceptedAt: '2026-01-01T00:00:00Z',
});

test('embedded order payload derives sandbox identity and omits contact fields', () => {
  const payload = buildEmbeddedOrderPayload(input, 'authenticated-user', '127.0.0.1', 'server-only-token');
  assert.equal(payload.partnerUserRef, 'sandbox-authenticated-user');
  assert.equal(payload.paymentMethod, 'GUEST_CHECKOUT_APPLE_PAY');
  assert.equal(payload.userAuthToken, 'server-only-token');
  assert.equal('phoneNumber' in payload, false);
  assert.equal('email' in payload, false);
  assert.equal('agreementAcceptedAt' in payload, false);
});

test('embedded quote never includes a reusable token', () => {
  const quoteInput = { ...input, isQuote: true };
  const payload = buildEmbeddedOrderPayload(quoteInput, 'authenticated-user', '127.0.0.1', 'server-only-token');
  assert.equal('userAuthToken' in payload, false);
});

test('embedded token reuse defaults on but can be disabled without accepting a device token', () => {
  assert.equal(embeddedOrderInputSchema.parse({ ...input }).reuseUserAuthToken, true);
  assert.equal(embeddedOrderInputSchema.parse({ ...input, reuseUserAuthToken: false }).reuseUserAuthToken, false);
});

test('token keys are destination and environment scoped without raw identifiers', () => {
  const first = embeddedAuthTokenKey('user-a', 'base', '0x1111111111111111111111111111111111111111', 'prod');
  const otherDestination = embeddedAuthTokenKey('user-a', 'base', '0x2222222222222222222222222222222222222222', 'prod');
  const otherEnvironment = embeddedAuthTokenKey('user-a', 'base', '0x1111111111111111111111111111111111111111', 'staging');
  assert.notEqual(first, otherDestination);
  assert.notEqual(first, otherEnvironment);
  assert.equal(first.includes('user-a'), false);
  assert.equal(first.includes('0x1111'), false);
});
