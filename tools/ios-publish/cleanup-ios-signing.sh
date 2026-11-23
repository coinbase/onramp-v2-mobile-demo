#!/usr/bin/env bash
# Remove every piece of signing material the publish job created: the
# temporary keychain, installed provisioning profile, decoded certificate,
# App Store Connect key, and the build-time .env. Safe to run when earlier
# steps failed or never ran.
set -uo pipefail

signing="${RUNNER_TEMP}/ios-signing"
keychain="${signing}/signing.keychain-db"

if [ -f "$keychain" ]; then
  security delete-keychain "$keychain" || true
fi

if [ -f "${signing}/profile.env" ]; then
  # shellcheck source=/dev/null
  . "${signing}/profile.env"
  if [ -n "${PROFILE_UUID:-}" ]; then
    rm -f "$HOME/Library/Developer/Xcode/UserData/Provisioning Profiles/${PROFILE_UUID}.mobileprovision" \
      "$HOME/Library/MobileDevice/Provisioning Profiles/${PROFILE_UUID}.mobileprovision"
  fi
fi

rm -rf "$signing" "${RUNNER_TEMP}/private_keys" "${RUNNER_TEMP}/ios-build"
rm -f .env

echo "Signing material removed"
