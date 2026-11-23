#!/usr/bin/env bash
# Fail when a required TestFlight publish secret is empty. Prints names only.
# The App Store Connect API key is only required when IOS_UPLOAD is true.
set -euo pipefail

missing=0
required=(
  APPLE_TEAM_ID
  IOS_DIST_CERT_P12_BASE64
  IOS_DIST_CERT_PASSWORD
  IOS_PROVISIONING_PROFILE_BASE64
  EXPO_PUBLIC_CDP_PROJECT_ID
  EXPO_PUBLIC_APP_ATTEST_APP_ID
  EXPO_PUBLIC_BASE_URL
)

if [ "${IOS_UPLOAD:-true}" = "true" ]; then
  required+=(
    APP_STORE_CONNECT_API_KEY_ID
    APP_STORE_CONNECT_ISSUER_ID
    APP_STORE_CONNECT_API_KEY_P8_BASE64
  )
fi

for name in "${required[@]}"; do
  if [ -z "${!name:-}" ]; then
    echo "::error::Missing repository secret ${name}"
    missing=1
  fi
done

# App Attest only works when the app id matches the signing team and bundle.
if [ -n "${APPLE_TEAM_ID:-}" ] && [ -n "${EXPO_PUBLIC_APP_ATTEST_APP_ID:-}" ] &&
  [ "$EXPO_PUBLIC_APP_ATTEST_APP_ID" != "${APPLE_TEAM_ID}.com.coinbase.cdp-onramp" ]; then
  echo "::error::EXPO_PUBLIC_APP_ATTEST_APP_ID must be <APPLE_TEAM_ID>.com.coinbase.cdp-onramp"
  missing=1
fi

exit "$missing"
