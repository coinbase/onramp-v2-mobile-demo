#!/usr/bin/env bash
# Fail when a required Play publish secret is empty. Prints names only.
set -euo pipefail

missing=0
required=(
  ANDROID_UPLOAD_KEYSTORE_BASE64
  ANDROID_KEYSTORE_PASSWORD
  ANDROID_KEY_ALIAS
  ANDROID_KEY_PASSWORD
  PLAY_SERVICE_ACCOUNT_JSON
  EXPO_PUBLIC_CDP_PROJECT_ID
  EXPO_PUBLIC_BASE_URL
  EXPO_PUBLIC_ANDROID_CLOUD_PROJECT_NUMBER
)

for name in "${required[@]}"; do
  if [ -z "${!name:-}" ]; then
    echo "::error::Missing repository secret ${name}"
    missing=1
  fi
done

exit "$missing"
