#!/usr/bin/env bash
# Write the Expo public env file for a Play build. Values stay in the file.
# APP_VERSION here becomes the versionName (see tools/release/app-version.sh).
set -euo pipefail

umask 077
app_version="$(bash "$(dirname "$0")/../release/app-version.sh")"
onramp_project="${EXPO_PUBLIC_ONRAMP_PROJECT_ID:-$EXPO_PUBLIC_CDP_PROJECT_ID}"

{
  printf 'EXPO_PUBLIC_CDP_PROJECT_ID=%s\n' "$EXPO_PUBLIC_CDP_PROJECT_ID"
  printf 'EXPO_PUBLIC_ONRAMP_PROJECT_ID=%s\n' "$onramp_project"
  printf 'EXPO_PUBLIC_APP_ATTEST_APP_ID=%s\n' "${EXPO_PUBLIC_APP_ATTEST_APP_ID:-}"
  printf 'EXPO_PUBLIC_BASE_URL=%s\n' "$EXPO_PUBLIC_BASE_URL"
  printf 'EXPO_PUBLIC_ANDROID_CLOUD_PROJECT_NUMBER=%s\n' "$EXPO_PUBLIC_ANDROID_CLOUD_PROJECT_NUMBER"
  printf 'EXPO_PUBLIC_USE_EXPO_CRYPTO=false\n'
  if [ -n "${EXPO_PUBLIC_APP2APP_REDIRECT_URL:-}" ]; then
    printf 'EXPO_PUBLIC_APP2APP_REDIRECT_URL=%s\n' "$EXPO_PUBLIC_APP2APP_REDIRECT_URL"
  fi
  printf 'APP_VERSION=%s\n' "$app_version"
} > .env

echo "Android versionName ${app_version}"
