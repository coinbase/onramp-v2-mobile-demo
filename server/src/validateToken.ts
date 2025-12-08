import { generateJwt } from '@coinbase/cdp-sdk/auth';
import type { NextFunction, Request, Response } from 'express';

// TestFlight account constants (matches /constants/TestAccounts.ts)
const TESTFLIGHT_EMAIL = 'reviewer@coinbase-demo.app';
const TESTFLIGHT_PHONE = '+12345678901';
const TESTFLIGHT_USER_ID = '286ef934-f3b8-4e94-b61f-1f1a088ac95e';

// Cache validated tokens to reduce API calls
const tokenCache = new Map<string, { userId: string, expiresAt: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export async function validateAccessToken(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    // Check for TestFlight account (bypass authentication)
    const authHeader = req.headers.authorization;
    const token = authHeader?.replace('Bearer ', '');
    const isTestFlightToken = token?.includes('testflight');
    const isTestFlightEmail = req.body?.email === TESTFLIGHT_EMAIL;
    const isTestFlightPhone = req.body?.phoneNumber === TESTFLIGHT_PHONE;
    const isTestFlightUserId = req.body?.url?.includes(TESTFLIGHT_USER_ID);

    if (isTestFlightToken || isTestFlightEmail || isTestFlightPhone || isTestFlightUserId) {
      console.log('🧪 [AUTH] TestFlight account - bypassing authentication');
      req.userId = 'testflight-reviewer';
      req.userData = {
        id: 'testflight-reviewer',
        email: TESTFLIGHT_EMAIL,
        testAccount: true
      };
      return next();
    }

    // All /server/api calls require authentication
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.error('❌ [AUTH] Missing or invalid Authorization header');
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Authentication required. Please sign in to create transactions.'
      });
    }

    // Check cache first
    const cached = tokenCache.get(token as string);
    if (cached && cached.expiresAt > Date.now()) {
      req.userId = cached.userId;
      console.log('✅ [AUTH] Token validated (cached) - Request authenticated');
      return next();
    }

    // Validate with CDP API
    const jwtToken = await generateJwt({
      apiKeyId: process.env.CDP_API_KEY_ID!,
      apiKeySecret: process.env.CDP_API_KEY_SECRET!,
      requestMethod: 'POST',
      requestHost: 'api.cdp.coinbase.com',
      requestPath: '/platform/v2/end-users/auth/validate-token',
    });

    const response = await fetch(
      'https://api.cdp.coinbase.com/platform/v2/end-users/auth/validate-token',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${jwtToken}`
        },
        body: JSON.stringify({
          accessToken: token
        })
      }
    );

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unable to read error body');
      console.error('❌ [AUTH] Token validation failed:', response.status, errorText);
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid or expired access token'
      });
    }

    const userData = await response.json();
    const userEmail = userData.authenticationMethods[0]?.email || 'unknown';
    console.log('✅ [AUTH] Token validated (fresh) for user:', userEmail);

    // Check if this is a TestFlight test account by email
    const isTestAccount = userEmail === TESTFLIGHT_EMAIL || userEmail === 'devtest@coinbase-demo.app';

    // Cache the result
    tokenCache.set(token as string, {
      userId: userData.userId,
      expiresAt: Date.now() + CACHE_TTL
    });

    // Add user info to request
    req.userId = userData.userId;
    req.userData = {
      ...userData,
      testAccount: isTestAccount // Mark as test account if email matches
    };

    if (isTestAccount) {
      console.log('🧪 [AUTH] TestFlight email detected:', userEmail);
    }

    next();
  } catch (error) {
    console.error('❌ [AUTH] Token validation error:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Token validation failed'
    });
  }
}

// Cleanup expired cache entries every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [token, data] of tokenCache.entries()) {
    if (data.expiresAt <= now) {
      tokenCache.delete(token);
    }
  }
}, 10 * 60 * 1000);
