import app from '../../src/app.js';

/**
 * Catch-all proxy for every `/api/app2app/*` route (Vercel serverless).
 *
 * The app2app onramp routes are defined on the shared Express app
 * (see server/src/app.ts): /app2app/mobile/challenges, /sessions, and the
 * /app2app/mobile/projects/{projectId}/attestation/{challenges,registrations/{keyId}}
 * device-attestation endpoints. Vercel's file-based routing only exposes files under api/, so this
 * single catch-all forwards all of them to the Express app rather than adding a
 * separate function file per route.
 *
 * Vercel populates the dynamic segments in `req.query.slug`
 * (e.g. ['mobile','attestation','challenges']); we rebuild the Express path and
 * preserve any query string before delegating.
 */
export default function handler(req, res) {
  const { slug } = req.query ?? {};
  const segments = Array.isArray(slug) ? slug : slug ? [slug] : [];

  const queryIndex = req.url?.indexOf('?') ?? -1;
  const search = queryIndex >= 0 ? req.url.slice(queryIndex) : '';

  req.url = '/app2app/' + segments.join('/') + search;
  return app(req, res);
}
