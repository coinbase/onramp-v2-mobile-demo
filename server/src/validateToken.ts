import { generateJwt } from '@coinbase/cdp-sdk/auth';
import type { NextFunction, Request, Response } from 'express';

// Cache validated tokens to reduce API calls
const tokenCache = new Map<string, { userId: string, expiresAt: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export async function validateAccessToken(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.replace('Bearer ', '');

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

    // Cache the result
    tokenCache.set(token as string, {
      userId: userData.userId,
      expiresAt: Date.now() + CACHE_TTL
    });

    req.userId = userData.userId;
    req.userData = userData;

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
