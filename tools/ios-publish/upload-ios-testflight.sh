#!/usr/bin/env bash
# Upload the exported IPA to App Store Connect (TestFlight) with an
# App Store Connect API key. altool reads AuthKey_<id>.p8 from
# API_PRIVATE_KEYS_DIR; the key is written under $RUNNER_TEMP and removed by
# cleanup-ios-signing.sh.
set -euo pipefail

umask 077
export API_PRIVATE_KEYS_DIR="${RUNNER_TEMP}/private_keys"
mkdir -p "$API_PRIVATE_KEYS_DIR"
printf '%s' "$APP_STORE_CONNECT_API_KEY_P8_BASE64" | base64 -D \
  > "${API_PRIVATE_KEYS_DIR}/AuthKey_${APP_STORE_CONNECT_API_KEY_ID}.p8"

if [ -z "${IOS_IPA_PATH:-}" ] || [ ! -f "$IOS_IPA_PATH" ]; then
  echo "::error::No exported IPA found; the build step must run first"
  exit 1
fi

xcrun altool --upload-app --type ios \
  --file "$IOS_IPA_PATH" \
  --apiKey "$APP_STORE_CONNECT_API_KEY_ID" \
  --apiIssuer "$APP_STORE_CONNECT_ISSUER_ID"

echo "Uploaded to App Store Connect. The build appears in TestFlight after Apple finishes processing."
