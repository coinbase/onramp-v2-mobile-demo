import app from '../src/app.js';

/**
 * Catch-all proxy for every `/api/app2app/*` route (Vercel serverless).
 *
 * The app2app onramp routes are defined on the shared Express app
 * (see server/src/app.ts): /app2app/mobile/challenges, /sessions, and the
 * /app2app/mobile/projects/{projectId}/attestation/{challenges,registrations/{keyId}}
 * device-attestation endpoints.
 *
 * Vercel's zero-config builder does not reliably expose a `[...slug]` catch-all
 * for plain Node functions (it only matched a single path segment), so instead
 * vercel.json rewrites every `/api/app2app/*` request to this single function.
 * Rewrites are transparent to the destination function, so `req.url` still holds
 * the original incoming path; we strip the `/api/app2app` prefix and delegate to
 * Express, which serves routes mounted under `/app2app`.
 */
export default function handler(req, res) {
  req.url = (req.url || '/api/app2app').replace(/^\/api\/app2app/, '/app2app');
  return app(req, res);
}
