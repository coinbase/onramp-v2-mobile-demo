/**
 * Authenticated Fetch Wrapper
 *
 * Automatically adds CDP access token to all backend requests.
 * Drop-in replacement for fetch() - handles authentication transparently.
 *
 * Usage:
 * ```typescript
 * import { authenticatedFetch } from '@/utils/authenticatedFetch';
 *
 * // Instead of:
 * const response = await fetch(url, { headers: { Authorization: ... } });
 *
 * // Simply use:
 * const response = await authenticatedFetch(url, options);
 * ```
 *
 * Features:
 * - Automatically retrieves and injects CDP access token
 * - Merges with existing headers (won't overwrite Content-Type, etc.)
 * - Throws helpful errors if token unavailable
 * - Works with both string URLs and Request objects
 */

import { getAccessTokenGlobal } from './getAccessTokenGlobal';

export async function authenticatedFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const headers = new Headers(init?.headers || {});

  const token = await getAccessTokenGlobal();

  if (!token) {
    throw new Error('Authentication required. Please connect your wallet first.');
  }

  if (!headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  // Log for debugging (in development)
  if (__DEV__) {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    console.log('🔐 [AUTH FETCH] Authenticated request to:', url);
  }

  // Make the request with authentication
  return fetch(input, {
    ...init,
    headers,
  });
}
