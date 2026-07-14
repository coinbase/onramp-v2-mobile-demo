import cors from 'cors';
import crypto from 'crypto';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';

import { generateJwt } from '@coinbase/cdp-sdk/auth';
import { resolveClientIp } from './ip.js';
import { validateAccessToken } from './validateToken.js';
import { verifyLegacySignature, verifyWebhookSignature } from './verifyWebhookSignature.js';

// Database storage setup - use external DB for production, in-memory for local dev
let database: any = null;
// Backwards compatibility: fallback to REDIS_URL if DATABASE_URL not set
const databaseUrl = process.env.DATABASE_URL || process.env.REDIS_URL;
const useDatabase = !!databaseUrl;
if (useDatabase) {
  const { createClient } = await import('redis');
  database = await createClient({ url: databaseUrl! }).connect();
  console.log('✅ Using external database for push token storage (production)');
} else {
  console.log('ℹ️ Using in-memory storage for push tokens (local dev)');
}

// APNs setup for direct iOS push notifications
let apnProvider: any = null;
let useAPNs = false;
if (process.env.APNS_KEY_ID && process.env.APNS_TEAM_ID && process.env.APNS_KEY) {
  try {
    const apn = await import('@parse/node-apn');

    // Handle both actual newlines and escaped \n in env var
    // If the env var contains literal "\n" strings, replace them with actual newlines
    const apnsKey = process.env.APNS_KEY!.replace(/\\n/g, '\n');

    apnProvider = new apn.Provider({
      token: {
        key: apnsKey,
        keyId: process.env.APNS_KEY_ID!,
        teamId: process.env.APNS_TEAM_ID!
      },
      production: true // Use production APNs for TestFlight
    });
    useAPNs = true;
    console.log('✅ Using direct APNs for push notifications (production)');
  } catch (error) {
    console.error('❌ Failed to initialize APNs provider:', error instanceof Error ? error.message : error);
    console.warn('⚠️ Falling back to Expo push service');
    console.warn('💡 Check APNS_KEY format: must include -----BEGIN PRIVATE KEY----- header/footer');
    console.warn('💡 In Vercel, paste the key with actual newlines OR use \\n for line breaks');
  }
} else {
  console.log('ℹ️ Using Expo push service for notifications (dev)');
}

const app = express();
const PORT = Number(process.env.PORT || 3000);

// On Vercel, trust proxy to read x-forwarded-for
app.set('trust proxy', true);

// TEMP (device-reachability debugging): log every inbound request + source IP.
app.use((req, _res, next) => {
  console.log(`➡️  ${new Date().toISOString()} ${req.method} ${req.url} from ${req.socket.remoteAddress}`);
  next();
});

// Rate limiter for webhook endpoint (DoS protection)
// Limits expensive operations (DB lookups, external API calls)
// Note: Rate limiting applies to ALL requests. Signature verification happens
// inside the route handler AFTER rate limiting to prevent bypass attacks.
const webhookRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute window
  max: 100, // Limit each IP to 100 requests per minute
  message: { error: 'Too many webhook requests, please try again later' },
  standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false, // Disable `X-RateLimit-*` headers
  // Use IP address as the key
  keyGenerator: (req) => {
    // For webhooks from Coinbase, use x-forwarded-for if available
    return req.ip || req.headers['x-forwarded-for'] as string || 'unknown';
  }
});

// CORS Configuration - Prevent random websites from calling your API
// Note: This does NOT affect:
// - Mobile apps (React Native) - they don't send Origin header
// - Webhooks (Coinbase servers) - server-to-server calls bypass CORS
// - Postman/curl - non-browser clients bypass CORS
const allowedOrigins = [
  'http://localhost:8081',   // Expo dev server
  'http://localhost:19000',  // Expo dev server (alternative)
  'http://localhost:19006',  // Expo web
  ...(process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : [])
];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, server-to-server like webhooks)
    if (!origin) {
      return callback(null, true);
    }

    // Allow if origin is in allowlist
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    // Block all other origins (random websites)
    console.warn('⚠️ [CORS] Blocked request from unauthorized origin:', origin);
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// For webhook signature verification, we need raw body
// Use express.raw() for webhook routes before JSON parsing
app.use('/webhooks/onramp', express.raw({ type: 'application/json' }));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Inbound request logging (webhooks only)
app.use((req, _res, next) => {
  if (req.path.startsWith('/webhooks')) {
    console.log('📥 Webhook:', req.path);
  }
  next();
});

// Health check (no auth required)
app.get("/health", (_req, res) => {
  res.json({ ok: true, message: 'Server is running' });
});

// 🔒 GLOBAL AUTHENTICATION MIDDLEWARE
// All routes except /health and /webhooks require valid CDP access token
app.use((req, res, next) => {
  // Skip authentication for health check, webhooks, and debug endpoints.
  // /app2app/* is intentionally PUBLIC — these requests are trusted via the
  // iOS App Attest attestation in the body, not a CDP access token.
  if (
    req.path === '/health' ||
    req.path.startsWith('/webhooks') ||
    req.path === '/push-tokens/ping' ||
    req.path.startsWith('/app2app')
  ) {
    return next();
  }

  // Apply authentication to all other routes (including /push-tokens)
  return validateAccessToken(req, res, next);
});

// ============================================================================
// CDP API HELPER
// ============================================================================

/**
 * Signs a request with a server-side CDP JWT and forwards it to the upstream
 * Coinbase API. The JWT covers only the pathname — Coinbase rejects JWTs that
 * include query parameters in the signed path.
 */
async function cdpFetch(
  url: string,
  method: 'GET' | 'POST',
  body?: unknown
): Promise<Response> {
  const urlObj = new URL(url);
  const jwt = await generateJwt({
    apiKeyId: process.env.CDP_API_KEY_ID!,
    apiKeySecret: process.env.CDP_API_KEY_SECRET!,
    requestMethod: method,
    requestHost: urlObj.hostname,
    requestPath: urlObj.pathname,
    expiresIn: 120,
  });

  return fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt}`,
    },
    ...(method === 'POST' && body != null ? { body: JSON.stringify(body) } : {}),
  });
}

/**
 * Mirrors an upstream CDP response (status + JSON body) back to the Express
 * response. Non-JSON bodies are wrapped as `{ error: "<text>" }`.
 */
async function forwardCdpResponse(
  upstream: Response,
  res: import('express').Response
): Promise<void> {
  const ct = upstream.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    const data = await upstream.json();
    res.status(upstream.status).json(data);
  } else {
    const text = await upstream.text();
    res.status(upstream.status).json({ error: text || 'Upstream API error' });
  }
}

// ============================================================================
// NAMED CDP PROXY ROUTES  (replace the former open /server/api proxy)
// ============================================================================
// Each route is scoped to exactly one upstream endpoint. User-identifying
// fields (userId, partnerUserRef) are derived from the validated access token
// stored in req.userId — never trusted from the client.
// ============================================================================

/**
 * GET /onramp/transactions
 * Fetch the authenticated user's onramp (buy) transaction history.
 * Query params: pageSize (default 10), pageKey (pagination cursor)
 */
app.get('/onramp/transactions', async (req, res) => {
  try {
    const userId = req.userId!;
    const { pageSize = '10', pageKey } = req.query as Record<string, string>;

    let url = `https://api.developer.coinbase.com/onramp/v1/buy/user/${encodeURIComponent(userId)}/transactions?pageSize=${encodeURIComponent(pageSize)}`;
    if (pageKey) url += `&pageKey=${encodeURIComponent(pageKey)}`;

    const upstream = await cdpFetch(url, 'GET');
    await forwardCdpResponse(upstream, res);
  } catch (error) {
    console.error('❌ [ONRAMP TX] Error:', error);
    res.status(500).json({ error: 'Failed to fetch onramp transactions' });
  }
});

/**
 * GET /offramp/transactions
 * Fetch the authenticated user's offramp (sell) transaction history.
 * Query param: sandbox=true appends the "sandbox-" prefix to the partnerUserRef.
 */
app.get('/offramp/transactions', async (req, res) => {
  try {
    const userId = req.userId!;
    const { sandbox } = req.query as Record<string, string>;
    const partnerUserRef = sandbox === 'true' ? `sandbox-${userId}` : userId;

    const url = `https://api.developer.coinbase.com/onramp/v1/sell/user/${encodeURIComponent(partnerUserRef)}/transactions`;
    const upstream = await cdpFetch(url, 'GET');
    await forwardCdpResponse(upstream, res);
  } catch (error) {
    console.error('❌ [OFFRAMP TX] Error:', error);
    res.status(500).json({ error: 'Failed to fetch offramp transactions' });
  }
});

/**
 * POST /onramp/session
 * Create a Coinbase Widget onramp session for the authenticated user.
 * Body: { purchaseCurrency, destinationNetwork, destinationAddress,
 *         paymentAmount, paymentCurrency, country, subdivision, redirectUrl }
 */
app.post('/onramp/session', async (req, res) => {
  try {
    const clientIp = await resolveClientIp(req);
    const url = `${resolveCdpApiBase()}/v2/onramp/sessions`;
    const body = { ...req.body, clientIp };

    const upstream = await cdpFetch(url, 'POST', body);
    await forwardCdpResponse(upstream, res);
  } catch (error) {
    console.error('❌ [ONRAMP SESSION] Error:', error);
    res.status(500).json({ error: 'Failed to create onramp session' });
  }
});

/**
 * POST /onramp/order
 * Create a guest-checkout (Apple Pay / Google Pay) onramp order.
 * Enforces that partnerUserRef in the body belongs to the authenticated user.
 * Body: { partnerUserRef, paymentAmount, paymentCurrency, purchaseCurrency,
 *         paymentMethod, destinationNetwork, destinationAddress,
 *         email, phoneNumber, phoneNumberVerifiedAt, agreementAcceptedAt, isQuote }
 */
app.post('/onramp/order', async (req, res) => {
  try {
    const userId = req.userId!;
    const { partnerUserRef } = req.body;

    if (partnerUserRef !== userId && partnerUserRef !== `sandbox-${userId}`) {
      console.error(`❌ [ONRAMP ORDER] partnerUserRef mismatch: got "${partnerUserRef}", expected "${userId}" or "sandbox-${userId}"`);
      return res.status(403).json({ error: 'Forbidden: partnerUserRef does not match authenticated user' });
    }

    const clientIp = await resolveClientIp(req);
    const url = `${resolveCdpApiBase()}/v2/onramp/orders`;
    const body = { ...req.body, clientIp };

    if (req.body.isQuote) {
      console.log('📌 [ONRAMP ORDER] Quote request');
    }

    const upstream = await cdpFetch(url, 'POST', body);
    await forwardCdpResponse(upstream, res);
  } catch (error) {
    console.error('❌ [ONRAMP ORDER] Error:', error);
    res.status(500).json({ error: 'Failed to create onramp order' });
  }
});

/**
 * POST /offramp/session
 * Obtain a single-use offramp session token for the Coinbase sell flow.
 * Body: { addresses: [{ address: string, blockchains: string[] }] }
 */
app.post('/offramp/session', async (req, res) => {
  try {
    const url = 'https://api.developer.coinbase.com/onramp/v1/token';
    const upstream = await cdpFetch(url, 'POST', req.body);
    await forwardCdpResponse(upstream, res);
  } catch (error) {
    console.error('❌ [OFFRAMP SESSION] Error:', error);
    res.status(500).json({ error: 'Failed to create offramp session' });
  }
});

/**
 * POST /onramp/limits
 * Fetch Apple Pay spending limits for the authenticated user.
 * Phone number is derived server-side from the validated auth token — never trusted from client.
 */
app.post('/onramp/limits', async (req, res) => {
  try {
    const phoneNumber = (req as any).userData?.authenticationMethods?.sms?.phoneNumber;
    if (!phoneNumber) {
      return res.status(400).json({ error: 'No phone number linked to this account' });
    }
    const url = `${resolveCdpApiBase()}/v2/onramp/limits`;
    const upstream = await cdpFetch(url, 'POST', {
      paymentMethodType: 'GUEST_CHECKOUT_APPLE_PAY',
      userId: phoneNumber,
      userIdType: 'phone_number',
    });
    await forwardCdpResponse(upstream, res);
  } catch (error) {
    console.error('❌ [ONRAMP LIMITS] Error:', error);
    res.status(500).json({ error: 'Failed to fetch onramp limits' });
  }
});

/**
 * GET /onramp/options
 * Fetch available onramp payment methods and currencies (public data).
 * All query params are forwarded as-is to the upstream.
 */
app.get('/onramp/options', async (req, res) => {
  try {
    const params = new URLSearchParams(req.query as Record<string, string>);
    const url = `https://api.developer.coinbase.com/onramp/v1/buy/options?${params.toString()}`;
    const upstream = await cdpFetch(url, 'GET');
    await forwardCdpResponse(upstream, res);
  } catch (error) {
    console.error('❌ [ONRAMP OPTIONS] Error:', error);
    res.status(500).json({ error: 'Failed to fetch onramp options' });
  }
});

/**
 * GET /onramp/config
 * Fetch the onramp supported-countries configuration (public data).
 */
app.get('/onramp/config', async (req, res) => {
  try {
    const url = 'https://api.developer.coinbase.com/onramp/v1/buy/config';
    const upstream = await cdpFetch(url, 'GET');
    await forwardCdpResponse(upstream, res);
  } catch (error) {
    console.error('❌ [ONRAMP CONFIG] Error:', error);
    res.status(500).json({ error: 'Failed to fetch onramp config' });
  }
});


/**
 * ============================================================================
 * APP-TO-APP ONRAMP  —  PUBLIC MOBILE ENDPOINTS (CDP PROXY)
 * ============================================================================
 *
 * Public counterpart to the create onramp order API. Unlike /server/api these
 * routes are NOT JWT-signed and NOT behind the access-token middleware — the
 * trust anchor is the platform attestation (iOS App Attest / Android Play
 * Integrity) carried in the request body, not a CDP access token.
 *
 * These are thin pass-through proxies to the real CDP "onramp mobile" APIs
 * shipped in cdp-api PR #1278 (c3/cdp-api). The 2-step app2app handoff:
 *
 *   1. POST /app2app/mobile/challenges  → { challenge, expiresAt }
 *        Binds the transaction params (amount, asset, network, destination,
 *        redirectUrl) to a server-issued opaque token, which doubles as the
 *        attestation challenge.
 *   2. POST /app2app/mobile/sessions    → { session: { onrampUrl }, quote? }
 *        Verifies the device attestation/assertion signed over the challenge
 *        and returns a ready-to-use onramp URL (with the session token embedded)
 *        to hand off to the Coinbase retail app.
 *
 * Upstream (public, unauthenticated) CDP endpoints:
 *   POST {base}/v2/onramp/mobile/challenges
 *   POST {base}/v2/onramp/mobile/sessions
 *
 * We keep the proxy so the app talks to a single base URL (no CORS, central
 * logging); no CDP JWT is added because the upstream is unauthenticated.
 *
 * The upstream environment is configurable for testing (see resolution below):
 *   - CDP_API_BASE_URL  — explicit full base override (wins if set)
 *   - CDP_ENV           — prod (default) | staging | dev
 * dev/staging are internal Coinbase hosts (cbhq.net) and require network/VPN
 * access. Defaults to production so nothing changes unless you opt in.
 * ============================================================================
 */

// CDP API base per environment (path includes the `/platform` prefix).
const CDP_API_BASE_PROD = 'https://api.cdp.coinbase.com/platform';
const CDP_API_BASES: Record<string, string> = {
  prod: CDP_API_BASE_PROD,
  staging: 'https://cloud-api-staging.cbhq.net/platform',
  dev: 'https://cloud-api-dev.cbhq.net/platform',
};

// Resolve the upstream base LAZILY (per request) rather than at module load:
// dev.ts loads dotenv after the (hoisted) `import app`, so reading process.env
// at module-eval time would miss .env values. An explicit CDP_API_BASE_URL
// wins; otherwise pick by CDP_ENV; otherwise default to production.
function resolveCdpApiBase(): string {
  return (
    process.env.CDP_API_BASE_URL ||
    CDP_API_BASES[(process.env.CDP_ENV || 'prod').toLowerCase()] ||
    CDP_API_BASE_PROD
  ).replace(/\/+$/, '');
}

function onrampMobileBase(): string {
  return `${resolveCdpApiBase()}/v2/onramp/mobile`;
}

/**
 * Forwards a JSON body to a public (unauthenticated) CDP onramp-mobile endpoint
 * and mirrors the upstream status + JSON back to the caller.
 *
 * For e2e testing this logs the full request + response of each upstream call.
 * The bodies here contain transaction params, a platform attestation/assertion
 * and a session URL — none of the prohibited PII categories — so they are safe
 * to dump while debugging. This verbosity is gated on APP2APP_VERBOSE !== '0'.
 */
const APP2APP_VERBOSE = process.env.APP2APP_VERBOSE !== '0';

async function proxyOnrampMobile(
  label: string,
  upstreamUrl: string,
  body: unknown,
  extraHeaders: Record<string, string>,
  res: import('express').Response,
  method: 'POST' | 'PUT' = 'POST',
): Promise<void> {
  const startedAt = Date.now();

  // The CDP onramp-mobile routes are spec'd `unauthenticated`, so we do NOT
  // attach a JWT by default. Opt in with APP2APP_SIGN_JWT=1 only for debugging
  // gateway auth behavior.
  const authHeaders: Record<string, string> = {};
  let jwtAttached = false;
  if (
    process.env.APP2APP_SIGN_JWT === '1' &&
    process.env.CDP_API_KEY_ID &&
    process.env.CDP_API_KEY_SECRET
  ) {
    try {
      const u = new URL(upstreamUrl);
      const token = await generateJwt({
        apiKeyId: process.env.CDP_API_KEY_ID,
        apiKeySecret: process.env.CDP_API_KEY_SECRET,
        requestMethod: method,
        requestHost: u.hostname,
        requestPath: u.pathname, // no query string — CDP signs pathname only
        expiresIn: 120,
      });
      authHeaders.Authorization = `Bearer ${token}`;
      jwtAttached = true;
    } catch (e) {
      console.error('⚠️ [APP2APP] Failed to sign CDP JWT:', e);
    }
  }

  // Some endpoints (e.g. the attestation challenge, whose params are all in the
  // path) take no request body; skip serializing one so we don't send `{}`.
  const hasBody = body !== undefined && body !== null;

  if (APP2APP_VERBOSE) {
    console.log(`\n┌─ [APP2APP] ${label} ▶ REQUEST ────────────────────────────────`);
    console.log(`│ ${method} ${upstreamUrl}  (jwt=${jwtAttached})`);
    if (hasBody) {
      console.log(`│ body: ${JSON.stringify(body, null, 2).replace(/\n/g, '\n│ ')}`);
    }
    console.log(`└──────────────────────────────────────────────────────────────`);
  }

  const requestInit: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json', ...authHeaders, ...extraHeaders },
  };
  if (hasBody) {
    requestInit.body = JSON.stringify(body);
  }

  const upstream = await fetch(upstreamUrl, requestInit);

  const text = await upstream.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { errorMessage: text };
  }

  if (APP2APP_VERBOSE) {
    const ms = Date.now() - startedAt;
    const icon = upstream.ok ? '✅' : '❌';
    console.log(`\n┌─ [APP2APP] ${label} ◀ RESPONSE ${icon} ${upstream.status} (${ms}ms) ─────────`);
    console.log(`│ ${JSON.stringify(data, null, 2).replace(/\n/g, '\n│ ')}`);
    console.log(`└──────────────────────────────────────────────────────────────\n`);
  }

  res.status(upstream.status).json(data);
}

// Step 1 — create challenge & bind session params.
app.post('/app2app/mobile/challenges', async (req, res) => {
  try {
    const body = req.body ?? {};

    // Idempotency-Key is an accepted request parameter; forward the client's if
    // present, otherwise mint one so retries are safe.
    const idempotencyKey =
      (req.header('Idempotency-Key') as string) || crypto.randomUUID();

    await proxyOnrampMobile(
      'createOnrampMobileChallenge',
      `${onrampMobileBase()}/challenges`,
      body,
      { 'Idempotency-Key': idempotencyKey },
      res,
    );
  } catch (error) {
    console.error('❌ [APP2APP] challenge proxy error:', error);
    res.status(502).json({ errorMessage: 'Failed to reach onramp mobile challenge API' });
  }
});

// Step 2 — verify attestation & return the onramp session URL. Idempotent on
// the challenge upstream, so no Idempotency-Key header is required.
app.post('/app2app/mobile/sessions', async (req, res) => {
  try {
    const body = req.body ?? {};

    await proxyOnrampMobile(
      'createOnrampMobileSession',
      `${onrampMobileBase()}/sessions`,
      body,
      {},
      res,
    );
  } catch (error) {
    console.error('❌ [APP2APP] session proxy error:', error);
    res.status(502).json({ errorMessage: 'Failed to reach onramp mobile session API' });
  }
});

/**
 * One-time iOS App Attest device-key REGISTRATION (c3/cdp-api → /v2/onramp/
 * mobile/projects/{projectId}/attestation/*). iOS-only; Android validates
 * Play Integrity inline per request and has no registration step.
 *
 *   A. POST /app2app/mobile/projects/:projectId/attestation/challenges
 *        → { challenge, expiresAt }  — one-time registration challenge.
 *   B. PUT  /app2app/mobile/projects/:projectId/attestation/registrations/:keyId
 *        → { appId, keyId, … }  — verifies the Apple attestation object signed
 *        over SHA-256(challenge) and stores the device public key.
 *
 * Per onramp-service PR #1840 (cdp-api v1.41.0 strict handlers), projectId and
 * keyId are path parameters (projectId uuid-validated upstream) and registration
 * is a PUT keyed on keyId. Both are public/unauthenticated (trust comes from the
 * attestation itself), so we forward without a CDP JWT.
 */

// Step A — issue a one-time iOS App Attest registration challenge. projectId is
// a path param; the upstream endpoint takes no request body.
app.post('/app2app/mobile/projects/:projectId/attestation/challenges', async (req, res) => {
  try {
    const { projectId } = req.params;

    await proxyOnrampMobile(
      'createOnrampAttestationChallenge',
      `${onrampMobileBase()}/projects/${encodeURIComponent(projectId)}/attestation/challenges`,
      undefined,
      {},
      res,
    );
  } catch (error) {
    console.error('❌ [APP2APP] attestation challenge proxy error:', error);
    res.status(502).json({ errorMessage: 'Failed to reach onramp attestation challenge API' });
  }
});

// Step B — verify the attestation object & register the device public key.
// projectId and keyId are path params; the body carries { challenge, ios }.
app.put(
  '/app2app/mobile/projects/:projectId/attestation/registrations/:keyId',
  async (req, res) => {
    try {
      const { projectId, keyId } = req.params;
      const body = req.body ?? {};

      await proxyOnrampMobile(
        'registerOnrampAttestation',
        `${onrampMobileBase()}/projects/${encodeURIComponent(projectId)}/attestation/registrations/${encodeURIComponent(keyId)}`,
        body,
        {},
        res,
        'PUT',
      );
    } catch (error) {
      console.error('❌ [APP2APP] attestation registration proxy error:', error);
      res.status(502).json({ errorMessage: 'Failed to reach onramp attestation registration API' });
    }
  },
);

// Zod schema for EVM balance query validation (SSRF protection)
const evmBalanceQuerySchema = z.object({
  address: z.string()
    .regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid EVM address format'),
  network: z.enum(['base', 'ethereum', 'base-sepolia', 'ethereum-sepolia'])
    .default('base')
});

/**
 * EVM Token Balance Endpoint
 * GET /balances/evm?address=0x...&network=base
 *
 * Supported networks: base, ethereum, base-sepolia (testnets)
 * Returns token balances with USD prices from Coinbase Price API
 */
app.get('/balances/evm', async (req, res) => {
  try {
    // Validate and sanitize query parameters to prevent SSRF
    const validationResult = evmBalanceQuerySchema.safeParse(req.query);

    if (!validationResult.success) {
      return res.status(400).json({
        error: 'Invalid request parameters',
        details: validationResult.error.issues
      });
    }

    const { address, network } = validationResult.data;

    console.log(`💰 [BALANCES] Fetching EVM balances - Address: ${address}, Network: ${network}`);

    // Ethereum Sepolia uses v1 REST API with network name (not chain ID)
    if (network === 'ethereum-sepolia') {
      const balancesPath = `/platform/v1/networks/ethereum-sepolia/addresses/${address}/balances`;
      const balancesUrl = `https://api.cdp.coinbase.com${balancesPath}`;

      console.log(`🔗 [BALANCES] Ethereum Sepolia URL (v1 API): ${balancesUrl}`);

      const authToken = await generateJwt({
        apiKeyId: process.env.CDP_API_KEY_ID!,
        apiKeySecret: process.env.CDP_API_KEY_SECRET!,
        requestMethod: 'GET',
        requestHost: 'api.cdp.coinbase.com',
        requestPath: balancesPath,
        expiresIn: 120
      });

      const balancesResponse = await fetch(balancesUrl, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${authToken}` }
      });

      console.log(`📡 [BALANCES] Response status: ${balancesResponse.status} ${balancesResponse.statusText}`);

      if (!balancesResponse.ok) {
        const errorText = await balancesResponse.text();
        console.error('❌ [BALANCES] CDP API error response:', errorText);

        let errorData;
        try {
          errorData = JSON.parse(errorText);
        } catch {
          errorData = { message: errorText };
        }

        console.error('❌ [BALANCES] CDP API error details:', errorData);
        return res.status(balancesResponse.status).json({
          error: 'Failed to fetch Ethereum Sepolia balances from CDP',
          details: errorData
        });
      }

      const balancesData = await balancesResponse.json();
      const balances = balancesData.data || [];

      console.log(`✅ [BALANCES] Fetched ${balances.length} Ethereum Sepolia balances`);

      // Transform v1 response to match v2 format
      const transformedBalances = balances
        .filter((b: any) => parseFloat(b.amount || '0') > 0)
        .map((b: any) => ({
          token: {
            symbol: (b.asset?.asset_id || 'UNKNOWN').toUpperCase(), // asset_id is lowercase, convert to uppercase
            contractAddress: b.asset?.contract_address || null,
            name: b.asset?.name || null,
          },
          amount: {
            amount: b.amount || '0',
            decimals: String(b.asset?.decimals || '18'), // Ensure string format
          },
          usdValue: null,
        }));

      return res.json({
        balances: transformedBalances,
        totalBalances: transformedBalances.length
      });
    }

    // For other networks (base, ethereum, base-sepolia), use v2 API
    const balancesPath = `/platform/v2/evm/token-balances/${network}/${address}`;
    const balancesUrl = `https://api.cdp.coinbase.com${balancesPath}`;

    const authToken = await generateJwt({
      apiKeyId: process.env.CDP_API_KEY_ID!,
      apiKeySecret: process.env.CDP_API_KEY_SECRET!,
      requestMethod: 'GET',
      requestHost: 'api.cdp.coinbase.com',
      requestPath: balancesPath,
      expiresIn: 120
    });

    const balancesResponse = await fetch(balancesUrl, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${authToken}` }
    });

    console.log(`📡 [BALANCES] Response status: ${balancesResponse.status} ${balancesResponse.statusText}`);

    if (!balancesResponse.ok) {
      const errorText = await balancesResponse.text();
      console.error('❌ [BALANCES] CDP API error response:', errorText);

      let errorData;
      try {
        errorData = JSON.parse(errorText);
      } catch {
        errorData = { message: errorText };
      }

      console.error('❌ [BALANCES] CDP API error details:', errorData);
      return res.status(balancesResponse.status).json({
        error: 'Failed to fetch balances from CDP',
        details: errorData
      });
    }

    const balancesData = await balancesResponse.json();
    const balances = balancesData.balances || [];

    console.log(`✅ [BALANCES] Fetched ${balances.length} token balances`);

    // Filter zero balances and enrich with USD prices
    const enrichedBalances = await Promise.all(
      balances
        .filter((b: any) => parseFloat(b.amount?.amount || '0') > 0)
        .map(async (balance: any) => {
          const symbol = balance.token?.symbol || 'UNKNOWN';
          let usdPrice = null;
          let usdValue = null;

          if (symbol && symbol !== 'UNKNOWN') {
            try {
              const priceUrl = `https://api.coinbase.com/v2/prices/${symbol}-USD/spot`;
              const priceResponse = await fetch(priceUrl);

              if (priceResponse.ok) {
                const priceData = await priceResponse.json();
                usdPrice = parseFloat(priceData.data?.amount || '0');

                const tokenAmount = parseFloat(balance.amount?.amount || '0');
                const decimals = parseInt(balance.amount?.decimals || '0');
                const actualAmount = tokenAmount / Math.pow(10, decimals);
                usdValue = actualAmount * usdPrice;
              } else {
                console.warn(`⚠️ [PRICE] Price API returned ${priceResponse.status} for ${symbol}`);
              }
            } catch (e) {
              console.warn(`⚠️ [PRICE] Could not fetch price for ${symbol}:`, e instanceof Error ? e.message : e);
            }
          }

          return {
            token: balance.token,
            amount: balance.amount,
            usdPrice,
            usdValue
          };
        })
    );

    console.log(`💵 [BALANCES] Enriched ${enrichedBalances.length} balances with USD prices`);

    res.json({
      address,
      network,
      balances: enrichedBalances,
      totalBalances: enrichedBalances.length
    });

  } catch (error) {
    console.error('❌ [BALANCES] Error:', error);
    res.status(500).json({
      error: 'Failed to fetch token balances',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Solana Token Balance Endpoint
 * GET /balances/solana?address=...&network=solana
 *
 * Supported networks: solana (mainnet), solana-devnet (testnet)
 * Returns SPL token balances with USD prices from Coinbase Price API
 */
app.get('/balances/solana', async (req, res) => {
  try {
    const { address, network = 'solana' } = req.query;

    if (!address || typeof address !== 'string') {
      return res.status(400).json({ error: 'address query parameter required' });
    }

    // Basic Solana address validation (base58, 32-44 chars)
    if (!address.match(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/)) {
      return res.status(400).json({ error: 'Invalid Solana address format' });
    }

    // Validate and sanitize network input - use allowlist to prevent SSRF
    const validNetworks: Record<string, string> = {
      'solana': 'solana',
      'solana-devnet': 'solana-devnet'
    };
    const sanitizedNetwork = validNetworks[network as string];
    if (!sanitizedNetwork) {
      return res.status(400).json({ error: `Invalid network. Supported: ${Object.keys(validNetworks).join(', ')}` });
    }

    console.log(`💰 [BALANCES] Fetching Solana balances - Address: ${address}, Network: ${sanitizedNetwork}`);

    // Use sanitized values in URL construction to prevent SSRF
    const balancesPath = `/platform/v2/solana/token-balances/${sanitizedNetwork}/${address}`;
    const balancesUrl = `https://api.cdp.coinbase.com${balancesPath}`;

    console.log(`🔗 [BALANCES] Full URL: ${balancesUrl}`);

    const authToken = await generateJwt({
      apiKeyId: process.env.CDP_API_KEY_ID!,
      apiKeySecret: process.env.CDP_API_KEY_SECRET!,
      requestMethod: 'GET',
      requestHost: 'api.cdp.coinbase.com',
      requestPath: balancesPath,
      expiresIn: 120
    });

    const balancesResponse = await fetch(balancesUrl, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${authToken}` }
    });

    console.log(`📡 [BALANCES] Response status: ${balancesResponse.status} ${balancesResponse.statusText}`);

    if (!balancesResponse.ok) {
      const errorText = await balancesResponse.text();
      console.error('❌ [BALANCES] CDP API error response:', errorText);

      let errorData;
      try {
        errorData = JSON.parse(errorText);
      } catch {
        errorData = { message: errorText };
      }

      console.error('❌ [BALANCES] CDP API error details:', errorData);
      return res.status(balancesResponse.status).json({
        error: 'Failed to fetch Solana balances from CDP',
        details: errorData
      });
    }

    const balancesData = await balancesResponse.json();
    const balances = balancesData.balances || [];

    console.log(`✅ [BALANCES] Fetched ${balances.length} Solana token balances`);

    // Filter zero balances and enrich with USD prices
    const enrichedBalances = await Promise.all(
      balances
        .filter((b: any) => parseFloat(b.amount?.amount || '0') > 0)
        .map(async (balance: any) => {
          const symbol = balance.token?.symbol || 'UNKNOWN';
          let usdPrice = null;
          let usdValue = null;

          if (symbol && symbol !== 'UNKNOWN') {
            try {
              const priceUrl = `https://api.coinbase.com/v2/prices/${symbol}-USD/spot`;
              const priceResponse = await fetch(priceUrl);

              if (priceResponse.ok) {
                const priceData = await priceResponse.json();
                usdPrice = parseFloat(priceData.data?.amount || '0');

                const tokenAmount = parseFloat(balance.amount?.amount || '0');
                const decimals = parseInt(balance.amount?.decimals || '0');
                const actualAmount = tokenAmount / Math.pow(10, decimals);
                usdValue = actualAmount * usdPrice;
              } else {
                console.warn(`⚠️ [PRICE] Price API returned ${priceResponse.status} for ${symbol}`);
              }
            } catch (e) {
              console.warn(`⚠️ [PRICE] Could not fetch price for ${symbol}:`, e instanceof Error ? e.message : e);
            }
          }

          return {
            token: balance.token,
            amount: balance.amount,
            usdPrice,
            usdValue
          };
        })
    );

    console.log(`💵 [BALANCES] Enriched ${enrichedBalances.length} Solana balances with USD prices`);

    res.json({
      address,
      network,
      balances: enrichedBalances,
      totalBalances: enrichedBalances.length
    });

  } catch (error) {
    console.error('❌ [BALANCES] Error:', error);
    res.status(500).json({
      error: 'Failed to fetch Solana token balances',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Push Token Storage
 * POST /push-tokens
 *
 * Stores user's Expo push token for sending notifications
 * Uses Vercel KV (production) or in-memory Map (local dev)
 * Called when user opens app and registers for notifications
 */

// In-memory storage for local development
const pushTokenStore = new Map<string, { token: string; platform: string; tokenType?: string; updatedAt: number }>();

// In-memory webhook event log (keyed by partnerUserRef, capped at MAX_EVENTS_PER_USER)
type WebhookEvent = {
  eventType: string;
  transactionId: string | null;
  timestamp: string;
  amount?: string;
  currency?: string;
  network?: string;
  failureReason?: string;
  rawBody?: Record<string, any>;
};
const MAX_EVENTS_PER_USER = 20;
const eventLogStore = new Map<string, WebhookEvent[]>();

// Temporary cache for offramp.transaction.created events that have no partnerUserRef yet.
// Keyed by transactionId; flushed into the user's event log when a subsequent event resolves the ref.
const pendingOfframpCreated = new Map<string, WebhookEvent>();

async function storeWebhookEvent(partnerUserRef: string, event: WebhookEvent) {
  const sandboxKey = partnerUserRef.startsWith('sandbox-') ? partnerUserRef : `sandbox-${partnerUserRef}`;

  if (useDatabase && database) {
    // Redis: fetch existing, prepend new event, trim to cap, store for both keys
    const raw = await database.get(`webhookevents:${partnerUserRef}`);
    const existing: WebhookEvent[] = raw ? JSON.parse(raw) : [];
    const updated = [event, ...existing].slice(0, MAX_EVENTS_PER_USER);
    const serialized = JSON.stringify(updated);
    await database.set(`webhookevents:${partnerUserRef}`, serialized);
    await database.set(`webhookevents:${sandboxKey}`, serialized);
  } else {
    // In-memory fallback for local dev
    const existing = eventLogStore.get(partnerUserRef) || [];
    const updated = [event, ...existing].slice(0, MAX_EVENTS_PER_USER);
    eventLogStore.set(partnerUserRef, updated);
    eventLogStore.set(sandboxKey, updated);
  }
}

/**
 * Debug endpoint: Log when push token registration is attempted
 * No auth required - just for debugging TestFlight
 */
app.post('/push-tokens/ping', async (req, res) => {
  console.log('🔔 [PUSH DEBUG] Registration attempt detected from client:', {
    ...req.body,
    timestamp: new Date().toISOString()
  });
  res.json({ received: true });
});

app.post('/push-tokens', async (req, res) => {
  try {
    const { userId, pushToken, platform, tokenType } = req.body;

    console.log('📥 [PUSH] Registration request received:', {
      userId,
      platform,
      tokenType,
      reqUserId: req.userId,
      hasToken: !!pushToken,
      tokenLength: pushToken?.length
    });

    if (!userId || !pushToken) {
      console.error('❌ [PUSH] Missing required fields');
      return res.status(400).json({ error: 'userId and pushToken are required' });
    }

    // Security: Verify the authenticated user matches the userId they're trying to register
    // Allow both exact match AND sandbox-prefixed version (for webhook matching)
    const isValidUser = req.userId === userId || `sandbox-${req.userId}` === userId;
    if (!isValidUser) {
      console.error('❌ [PUSH] Unauthorized token registration attempt:', {
        tokenUserId: req.userId,
        requestUserId: userId,
        match: req.userId === userId,
        sandboxMatch: `sandbox-${req.userId}` === userId
      });
      return res.status(403).json({ error: 'Forbidden: Cannot register push token for another user' });
    }

    const tokenData = {
      token: pushToken,
      platform: platform || 'unknown',
      tokenType: tokenType || 'native', // 'native' for APNs/FCM, 'expo' for Expo push service
      updatedAt: Date.now(),
    };

    // Store in database (production) or in-memory (local dev)
    // Store for BOTH regular userId AND sandbox-prefixed userId
    // This ensures webhooks with "sandbox-{userId}" can find the token
    if (useDatabase && database) {
      await database.set(`pushtoken:${userId}`, JSON.stringify(tokenData));
      await database.set(`pushtoken:sandbox-${userId}`, JSON.stringify(tokenData));
      console.log('✅ [PUSH] Token stored in database for user:', userId, 'and sandbox-' + userId);
    } else {
      pushTokenStore.set(userId, tokenData);
      pushTokenStore.set(`sandbox-${userId}`, tokenData);
      console.log('✅ [PUSH] Token stored in memory for user:', userId, 'and sandbox-' + userId);
      console.log('📊 [PUSH] Total tokens in store:', pushTokenStore.size);
    }

    console.log('✅ [PUSH] Token registered successfully:', {
      userId,
      tokenType: tokenData.tokenType,
      platform: tokenData.platform
    });
    res.json({ success: true });
  } catch (error) {
    console.error('❌ [PUSH] Error:', error);
    res.status(500).json({ error: 'Failed to store push token' });
  }
});

// Debug endpoint to check push token status
app.get('/push-tokens/debug/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    let tokenData: any = null;
    if (useDatabase && database) {
      const data = await database.get(`pushtoken:${userId}`);
      tokenData = data ? JSON.parse(data) : null;
    } else {
      tokenData = pushTokenStore.get(userId) || null;
    }

    res.json({
      userId,
      hasToken: !!tokenData,
      tokenData: tokenData ? {
        platform: tokenData.platform,
        tokenType: tokenData.tokenType,
        tokenLength: tokenData.token?.length,
        updatedAt: new Date(tokenData.updatedAt).toISOString()
      } : null,
      storage: useDatabase ? 'database' : 'in-memory',
      allUserIds: useDatabase ? 'N/A (external database)' : Array.from(pushTokenStore.keys())
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to check token' });
  }
});

/**
 * Onramp Webhook Endpoint
 * POST /webhooks/onramp
 *
 * Receives transaction status updates from Coinbase
 * Events: onramp/offramp.transaction.created/updated/success/failed
 *
 * Security: Verifies webhook signature using CDP API key + Rate limiting (DoS protection)
 * Use case: Send push notifications when transactions complete
 *
 * Note: This endpoint is PUBLIC (no auth middleware) because Coinbase servers call it
 */
app.post('/webhooks/onramp', webhookRateLimiter, async (req, res) => {
  try {
    // Get raw body (from express.raw middleware)
    const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : JSON.stringify(req.body);

    // Parse JSON from raw body
    const webhookData = Buffer.isBuffer(req.body) ? JSON.parse(rawBody) : req.body;

    const eventType = webhookData.eventType || webhookData.event;
    console.log('🔔 [WEBHOOK] Received:', eventType);
    console.log('📦 [WEBHOOK] Full body:', JSON.stringify(webhookData, null, 2));

    // Verify webhook signature (security check)
    const webhookSecret = process.env.WEBHOOK_SECRET;

    if (webhookSecret) {
      // Try X-Hook0-Signature (new format)
      const hook0Signature = req.headers['x-hook0-signature'] as string;

      if (hook0Signature) {
        const isValid = verifyWebhookSignature(hook0Signature, req.headers, rawBody, webhookSecret);
        if (!isValid) {
          console.error('❌ [WEBHOOK] Invalid signature');
          return res.status(401).json({ error: 'Invalid signature' });
        }
        console.log('✅ [WEBHOOK] Signature verified');
      }
      // Fallback: Try x-coinbase-signature (legacy format)
      else {
        const coinbaseSignature = req.headers['x-coinbase-signature'] as string;
        const timestamp = req.headers['x-coinbase-timestamp'] as string;

        if (coinbaseSignature && timestamp) {
          const isValid = verifyLegacySignature(coinbaseSignature, timestamp, rawBody, webhookSecret);
          if (!isValid) {
            console.error('❌ [WEBHOOK] Invalid x-coinbase-signature');
            return res.status(401).json({ error: 'Invalid signature' });
          }
          console.log('✅ [WEBHOOK] x-coinbase-signature verified');
        } else {
          console.warn('⚠️ [WEBHOOK] No signature headers found - rejecting webhook');
          return res.status(401).json({ error: 'Missing signature headers' });
        }
      }
    } else {
      console.warn('⚠️ [WEBHOOK] WEBHOOK_SECRET not set - skipping verification (INSECURE!)');
    }

    // Extract transaction ID (different field names)
    const txId = webhookData.transactionId || webhookData.orderId || webhookData.data?.transaction?.id;

    // Handle different webhook events
    switch (eventType) {
      case 'onramp.transaction.created':
        console.log('📝 [WEBHOOK] Transaction created:', txId);
        // Transaction initiated - could send "processing" notification
        break;

      case 'onramp.transaction.updated':
        console.log('🔄 [WEBHOOK] Transaction updated:', txId);
        // Transaction status changed - could track intermediate states
        break;

      case 'onramp.transaction.success':
      case 'onramp.transaction.completed': // Support both event names
        console.log('✅ [WEBHOOK] Transaction completed:', txId);

        // Extract fields (handle both Apple Pay and Widget formats)
        // Apple Pay: { purchaseAmount: "100.000000", purchaseCurrency: "USDC", destinationNetwork: "base" }
        // Widget: { purchaseAmount: { value: "4.81", currency: "USDC" }, purchaseCurrency: "USDC", purchaseNetwork: "ethereum" }

        const amount = typeof webhookData.purchaseAmount === 'object'
          ? webhookData.purchaseAmount?.value
          : webhookData.purchaseAmount;

        const currency = webhookData.purchaseCurrency;

        const network = webhookData.destinationNetwork || webhookData.purchaseNetwork;

        const partnerUserRef = webhookData.partnerUserRef;

        console.log('💰 [WEBHOOK] User received:', {
          amount,
          currency,
          network,
          address: webhookData.destinationAddress || webhookData.walletAddress,
          partnerUserRef
        });

        // Send push notification via Expo Push API (user-specific)
        try {
          if (!partnerUserRef) {
            console.log('⚠️ [WEBHOOK] No partnerUserRef in transaction - cannot send notification');
            break;
          }

          // Prepare notification content
          const title = '🎉 Crypto Purchase Complete!';
          const body = `Your ${amount} ${currency} has been delivered to your ${network} wallet!`;
          const notificationData = {
            transactionId: txId,
            type: 'onramp_complete',
            partnerUserRef
          };

          // Retrieve push token from database (production) or in-memory (local dev)
          let userTokenData: { token: string; platform: string; tokenType?: string; updatedAt: number } | null;
          if (useDatabase && database) {
            const data = await database.get(`pushtoken:${partnerUserRef}`);
            userTokenData = data ? JSON.parse(data) : null;
          } else {
            userTokenData = pushTokenStore.get(partnerUserRef) || null;
          }

          if (userTokenData) {
            try {
              // Choose notification service based on token type
              // Native tokens: Use direct APNs (if configured)
              // Expo tokens: Use Expo push service
              const isNativeToken = userTokenData.tokenType === 'native' || !userTokenData.tokenType; // default to native for backwards compatibility

              if (isNativeToken && useAPNs && apnProvider && userTokenData.platform === 'ios') {
                console.log('📤 [WEBHOOK] Sending via direct APNs');
                console.log('🔍 [WEBHOOK] Token data:', {
                  token: userTokenData.token,
                  tokenType: typeof userTokenData.token,
                  tokenLength: typeof userTokenData.token === 'string' ? userTokenData.token.length : 'N/A'
                });

                const apn = await import('@parse/node-apn');
                const notification = new apn.Notification({
                  alert: { title, body },
                  topic: 'com.coinbase.cdp-onramp', // Your bundle ID
                  sound: 'default',
                  payload: notificationData
                });

                const result = await apnProvider.send(notification, userTokenData.token);
                console.log('📊 [WEBHOOK] APNs result:', {
                  sent: result.sent?.length || 0,
                  failed: result.failed?.length || 0
                });

                if (result.failed && result.failed.length > 0) {
                  const failure = result.failed[0];
                  console.error('❌ [WEBHOOK] APNs failures:', result.failed.map((f: any) => ({
                    device: f.device,
                    status: f.status,
                    response: f.response
                  })));

                  // If BadDeviceToken, token might be for wrong environment (sandbox vs production)
                  // Try sandbox environment as fallback
                  if (failure.response?.reason === 'BadDeviceToken') {
                    console.log('🔄 [WEBHOOK] Trying sandbox APNs environment...');
                    try {
                      const sandboxProvider = new apn.Provider({
                        token: {
                          key: process.env.APNS_KEY!.replace(/\\n/g, '\n'),
                          keyId: process.env.APNS_KEY_ID!,
                          teamId: process.env.APNS_TEAM_ID!
                        },
                        production: false // Try sandbox
                      });
                      const sandboxResult = await sandboxProvider.send(notification, userTokenData.token);
                      if (sandboxResult.sent && sandboxResult.sent.length > 0) {
                        console.log('✅ [WEBHOOK] APNs notification sent via SANDBOX environment');
                      } else {
                        console.error('❌ [WEBHOOK] Sandbox APNs also failed');
                      }
                    } catch (sandboxError) {
                      console.error('❌ [WEBHOOK] Sandbox APNs error:', sandboxError);
                    }
                  }
                } else {
                  console.log('✅ [WEBHOOK] APNs notification sent successfully');
                }
              } else {
                console.log('📤 [WEBHOOK] Sending via Expo push service');
                const message = {
                  to: userTokenData.token,
                  sound: 'default',
                  title,
                  body,
                  data: notificationData,
                };

                const pushResponse = await fetch('https://exp.host/--/api/v2/push/send', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify(message),
                });

                const pushResult = await pushResponse.json();
                console.log('📤 [WEBHOOK] Push notification response:', JSON.stringify(pushResult));

                // Check if push failed due to credentials
                if (pushResult.data?.status === 'error') {
                  console.error('❌ [WEBHOOK] Push delivery error:', pushResult.data.message);
                  console.error('💡 [WEBHOOK] Hint: Add APNs credentials to .env for direct APNs');
                } else {
                  console.log('✅ [WEBHOOK] Push notification sent for transaction:', txId);
                }
              }
            } catch (pushError) {
              console.error('❌ [WEBHOOK] Failed to send push notification:', pushError);
            }
          } else {
            console.log('⚠️ [WEBHOOK] No push token found for user:', partnerUserRef);
          }
        } catch (error) {
          console.error('❌ [WEBHOOK] Failed to process notification:', error);
        }
        break;

      case 'onramp.transaction.failed':
        console.log('❌ [WEBHOOK] Transaction failed:', txId);

        // Extract failure fields (handle both formats)
        const failedAmount = typeof webhookData.paymentAmount === 'object'
          ? webhookData.paymentAmount?.value
          : webhookData.paymentAmount;

        const failedCurrency = typeof webhookData.paymentAmount === 'object'
          ? webhookData.paymentAmount?.currency
          : webhookData.paymentCurrency;

        const failureReason = webhookData.failureReason || 'Unknown error';
        const failedPartnerUserRef = webhookData.partnerUserRef;

        console.log('⚠️ [WEBHOOK] Failure details:', {
          amount: failedAmount,
          currency: failedCurrency,
          reason: failureReason,
          partnerUserRef: failedPartnerUserRef
        });

        // Send notification for failed transaction (user-specific)
        try {
          if (!failedPartnerUserRef) {
            console.log('⚠️ [WEBHOOK] No partnerUserRef in failed transaction - cannot send notification');
            break;
          }

          // Prepare notification content
          const failTitle = '❌ Transaction Failed';
          const failBody = `Your purchase failed: ${failureReason}. Please try again.`;
          const failData = {
            transactionId: txId,
            type: 'onramp_failed',
            partnerUserRef: failedPartnerUserRef
          };

          // Retrieve push token from database (production) or in-memory (local dev)
          let failedUserTokenData: { token: string; platform: string; tokenType?: string; updatedAt: number } | null;
          if (useDatabase && database) {
            const data = await database.get(`pushtoken:${failedPartnerUserRef}`);
            failedUserTokenData = data ? JSON.parse(data) : null;
          } else {
            failedUserTokenData = pushTokenStore.get(failedPartnerUserRef) || null;
          }

          if (failedUserTokenData) {
            try {
              // Choose notification service based on token type
              const isNativeToken = failedUserTokenData.tokenType === 'native' || !failedUserTokenData.tokenType;

              if (isNativeToken && useAPNs && apnProvider && failedUserTokenData.platform === 'ios') {
                console.log('📤 [WEBHOOK] Sending failure notification via direct APNs');
                const apn = await import('@parse/node-apn');
                const notification = new apn.Notification({
                  alert: { title: failTitle, body: failBody },
                  topic: 'com.coinbase.cdp-onramp', // Your bundle ID
                  sound: 'default',
                  payload: failData
                });

                const result = await apnProvider.send(notification, failedUserTokenData.token);
                console.log('📊 [WEBHOOK] APNs result:', {
                  sent: result.sent?.length || 0,
                  failed: result.failed?.length || 0
                });

                if (result.failed && result.failed.length > 0) {
                  console.error('❌ [WEBHOOK] APNs failures:', result.failed.map((f: any) => ({
                    device: f.device,
                    status: f.status,
                    response: f.response
                  })));
                } else {
                  console.log('✅ [WEBHOOK] APNs failure notification sent successfully');
                }
              } else {
                console.log('📤 [WEBHOOK] Sending failure notification via Expo push service');
                const failureMessage = {
                  to: failedUserTokenData.token,
                  sound: 'default',
                  title: failTitle,
                  body: failBody,
                  data: failData,
                };

                const pushResponse = await fetch('https://exp.host/--/api/v2/push/send', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify(failureMessage),
                });

                const pushResult = await pushResponse.json();
                console.log('✅ [WEBHOOK] Failure push notification sent for transaction:', txId);
              }
            } catch (pushError) {
              console.error('❌ [WEBHOOK] Failed to send failure push notification:', pushError);
            }
          } else {
            console.log('⚠️ [WEBHOOK] No push token found for user:', failedPartnerUserRef);
          }
        } catch (error) {
          console.error('❌ [WEBHOOK] Error processing failure notification:', error);
        }
        break;

      case 'offramp.transaction.created':
        console.log('📝 [WEBHOOK] Offramp transaction created:', txId);
        break;

      case 'offramp.transaction.updated':
        console.log('🔄 [WEBHOOK] Offramp transaction updated:', txId);
        break;

      case 'offramp.transaction.success':
        console.log('✅ [WEBHOOK] Offramp transaction completed:', txId);
        break;

      case 'offramp.transaction.failed':
        console.log('❌ [WEBHOOK] Offramp transaction failed:', txId);
        break;

      default:
        console.log('ℹ️ [WEBHOOK] Unknown event type:', eventType);
    }

    // Store event in the in-memory log so the app can fetch and display it
    // Offramp webhooks don't have a top-level partnerUserRef — extract it from redirectUrl query param
    let eventPartnerUserRef = webhookData.partnerUserRef || webhookData.failedPartnerUserRef;
    if (!eventPartnerUserRef && webhookData.redirectUrl) {
      try {
        const redirectUrl = new URL(webhookData.redirectUrl);
        eventPartnerUserRef = redirectUrl.searchParams.get('partnerUserRef') || undefined;
      } catch {}
    }

    // Onramp uses purchaseAmount/purchaseCurrency; offramp uses sellAmount.value/sellAmount.currency
    const eventAmount = typeof webhookData.purchaseAmount === 'object'
      ? webhookData.purchaseAmount?.value
      : (webhookData.purchaseAmount || webhookData.sellAmount?.value || webhookData.paymentAmount);
    const eventCurrency = webhookData.purchaseCurrency
      || webhookData.sellAmount?.currency
      || webhookData.paymentCurrency;
    const eventNetwork = webhookData.destinationNetwork || webhookData.purchaseNetwork || webhookData.network;

    if (!eventPartnerUserRef && eventType === 'offramp.transaction.created' && txId) {
      // No partnerUserRef yet — cache by transactionId and flush when a subsequent event resolves it
      pendingOfframpCreated.set(txId, {
        eventType,
        transactionId: txId,
        timestamp: new Date().toISOString(),
        amount: eventAmount,
        currency: eventCurrency,
        network: eventNetwork,
        rawBody: webhookData,
      });
      console.log('📋 [WEBHOOK] Offramp created event cached, awaiting partnerUserRef for txId:', txId);
    }

    if (eventPartnerUserRef) {
      // Flush any pending created event for this transaction first (preserves chronological order)
      if (txId && pendingOfframpCreated.has(txId)) {
        const pendingEvent = pendingOfframpCreated.get(txId)!;
        await storeWebhookEvent(eventPartnerUserRef, pendingEvent);
        pendingOfframpCreated.delete(txId);
        console.log('📋 [WEBHOOK] Flushed pending created event for txId:', txId);
      }
      await storeWebhookEvent(eventPartnerUserRef, {
        eventType,
        transactionId: txId || null,
        timestamp: new Date().toISOString(),
        amount: eventAmount,
        currency: eventCurrency,
        network: eventNetwork,
        failureReason: webhookData.failureReason,
        rawBody: webhookData,
      });
      console.log('📋 [WEBHOOK] Event stored for user:', eventPartnerUserRef);
    }

    // Always return 200 to acknowledge receipt
    // Coinbase will retry if we don't respond with 2xx
    res.status(200).json({ received: true });

  } catch (error) {
    console.error('❌ [WEBHOOK] Error processing webhook:', error);
    // Still return 200 to prevent retries on parsing errors
    res.status(200).json({ received: true, error: 'Processing error' });
  }
});

/**
 * GET /events/onramp
 *
 * Returns the recent webhook events received for the authenticated user.
 * Used by the History tab to display a live event log (created, updated, success, failed).
 * Events are stored in-memory on the server when Coinbase POSTs to /webhooks/onramp.
 */
app.get('/events/onramp', async (req, res) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    let events: WebhookEvent[] = [];
    if (useDatabase && database) {
      const raw = await database.get(`webhookevents:${userId}`) || await database.get(`webhookevents:sandbox-${userId}`);
      events = raw ? JSON.parse(raw) : [];
    } else {
      events = eventLogStore.get(userId) || eventLogStore.get(`sandbox-${userId}`) || [];
    }
    console.log('📋 [EVENTS] Returning %d events for user: %s', events.length, userId);
    res.json({ events });
  } catch (error) {
    console.error('❌ [EVENTS] Error fetching events:', error);
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

export default app;