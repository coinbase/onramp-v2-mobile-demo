/**
 * Digital Asset Links for Android App Links.
 *
 * Served at https://<domain>/.well-known/assetlinks.json via the vercel.json
 * rewrite. Required so https://<host>/onramp-return can reopen this demo after
 * Coinbase retail completes an App2App hand-off (parity with iOS AASA).
 *
 * Fill `sha256_cert_fingerprints` with the signing cert(s) used for Play /
 * internal builds before relying on verified App Links. Package name must match
 * app.config.ts `android.package` (`com.coinbase.cdp_onramp`) and the Android
 * entry registered on the CDP project (portal allowlist — COM2-3687).
 *
 * Until fingerprints are set, the custom scheme `onrampdemo://onramp-return`
 * still works as a redirectUrl fallback.
 */
const PACKAGE_NAME = 'com.coinbase.cdp_onramp';

const ASSET_LINKS = [
  {
    relation: ['delegate_permission/common.handle_all_urls'],
    target: {
      namespace: 'android_app',
      package_name: PACKAGE_NAME,
      // Replace with real SHA-256 cert fingerprints (colon-separated hex) for
      // the keystore(s) that sign distributable Android builds.
      sha256_cert_fingerprints: [],
    },
  },
];

export default function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.status(200).json(ASSET_LINKS);
}
