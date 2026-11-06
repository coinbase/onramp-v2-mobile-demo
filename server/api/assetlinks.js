/**
 * Digital Asset Links for Android App Links.
 *
 * Served at https://<domain>/.well-known/assetlinks.json via the vercel.json
 * rewrite. Lets https://<domain>/onramp-return open the Play-installed demo
 * (package com.coinbase.cdp_onramp) after retail redirects back.
 *
 * ANDROID_APP_LINK_SHA256 is the Play App Signing certificate fingerprint
 * (Play Console → App integrity → App signing), not the upload key. Comma-
 * separate more than one. Unset means we have nothing true to publish.
 */
const PACKAGE_NAME = "com.coinbase.cdp_onramp";

function fingerprints() {
  return (process.env.ANDROID_APP_LINK_SHA256 || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

export default function handler(req, res) {
  const sha256 = fingerprints();
  if (sha256.length === 0) {
    res.status(404).json({ errorMessage: "ANDROID_APP_LINK_SHA256 is not configured" });
    return;
  }

  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.status(200).json([
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: PACKAGE_NAME,
        sha256_cert_fingerprints: sha256,
      },
    },
  ]);
}
