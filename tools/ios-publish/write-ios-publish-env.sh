#!/usr/bin/env bash
# Write the Expo public env file for a TestFlight build. Values stay in the file.
# app.config.ts loads .env, so IOS_BUILD_NUMBER here becomes the iOS build number.
# The build number is 30000000 plus whole minutes since 2026-01-01 UTC, the same
# scheme as the Android versionCode: unique per minute and always increasing.
set -euo pipefail

umask 077
BUILD_NUMBER_BASE=30000000
BUILD_NUMBER_EPOCH=1767225600
build_number="$((BUILD_NUMBER_BASE + ($(date -u +%s) - BUILD_NUMBER_EPOCH) / 60))"
onramp_project="${EXPO_PUBLIC_ONRAMP_PROJECT_ID:-$EXPO_PUBLIC_CDP_PROJECT_ID}"

{
  printf 'EXPO_PUBLIC_CDP_PROJECT_ID=%s\n' "$EXPO_PUBLIC_CDP_PROJECT_ID"
  printf 'EXPO_PUBLIC_ONRAMP_PROJECT_ID=%s\n' "$onramp_project"
  printf 'EXPO_PUBLIC_APP_ATTEST_APP_ID=%s\n' "$EXPO_PUBLIC_APP_ATTEST_APP_ID"
  printf 'EXPO_PUBLIC_BASE_URL=%s\n' "$EXPO_PUBLIC_BASE_URL"
  printf 'EXPO_PUBLIC_USE_EXPO_CRYPTO=false\n'
  if [ -n "${EXPO_PUBLIC_APP2APP_REDIRECT_URL:-}" ]; then
    printf 'EXPO_PUBLIC_APP2APP_REDIRECT_URL=%s\n' "$EXPO_PUBLIC_APP2APP_REDIRECT_URL"
  fi
  printf 'IOS_BUILD_NUMBER=%s\n' "$build_number"
} > .env

echo "iOS build number ${build_number}"
