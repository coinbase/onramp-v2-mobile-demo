/**
 * Apple App Site Association (AASA) for iOS Universal Links.
 *
 * Served at https://<domain>/.well-known/apple-app-site-association via the
 * vercel.json rewrite (Apple fetches that well-known path; it must return 200
 * JSON over HTTPS with no redirect). Declares which paths on this domain open
 * the native app instead of the website — used for the app2app onramp return
 * (`/onramp-return`) and the offramp send hand-off (`/offramp-send`).
 *
 * appID is `teamID.bundleID` (public, also embedded in the app binary). Keep it
 * in sync with EXPO_PUBLIC_APP_ATTEST_APP_ID / the build's signing.
 */
const AASA = {
  applinks: {
    apps: [],
    details: [
      {
        appID: '3W8D3S7TCY.com.coinbase.cdp-onramp',
        paths: ['/onramp-return', '/onramp-return/*', '/offramp-send', '/offramp-send/*'],
      },
    ],
  },
};

export default function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.status(200).json(AASA);
}
