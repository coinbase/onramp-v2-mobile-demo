#!/usr/bin/env bash
# Import the Apple Distribution certificate into a temporary keychain and
# install the App Store provisioning profile. Checks that the profile belongs
# to APPLE_TEAM_ID, targets the app's bundle id, and carries the production
# App Attest entitlement. Prints names and UUIDs only, never secret values.
#
# Writes $RUNNER_TEMP/ios-signing/profile.env (profile UUID and name) for the
# build step. cleanup-ios-signing.sh removes everything created here.
set -euo pipefail

umask 077
BUNDLE_ID="com.coinbase.cdp-onramp"
work="${RUNNER_TEMP}/ios-signing"
keychain="${work}/signing.keychain-db"
mkdir -p "$work"

# Temporary keychain with a random password that never leaves this runner.
keychain_password="$(openssl rand -hex 24)"
security create-keychain -p "$keychain_password" "$keychain"
security set-keychain-settings -lut 21600 "$keychain"
security unlock-keychain -p "$keychain_password" "$keychain"

printf '%s' "$IOS_DIST_CERT_P12_BASE64" | base64 -D > "${work}/dist.p12"
security import "${work}/dist.p12" -k "$keychain" -P "$IOS_DIST_CERT_PASSWORD" \
  -f pkcs12 -t cert -T /usr/bin/codesign -T /usr/bin/security > /dev/null
rm -f "${work}/dist.p12"
security set-key-partition-list -S apple-tool:,apple:,codesign: -s \
  -k "$keychain_password" "$keychain" > /dev/null

# Search the temporary keychain first, keep the existing ones after it.
existing="$(security list-keychains -d user | sed -e 's/^ *"//' -e 's/"$//')"
# shellcheck disable=SC2086 # keychain paths on runners contain no spaces
security list-keychains -d user -s "$keychain" $existing

if ! security find-identity -v -p codesigning "$keychain" | grep -q "Apple Distribution"; then
  echo "::error::IOS_DIST_CERT_P12_BASE64 does not contain an Apple Distribution identity"
  exit 1
fi

# Decode the profile and read the fields the build needs.
printf '%s' "$IOS_PROVISIONING_PROFILE_BASE64" | base64 -D > "${work}/profile.mobileprovision"
security cms -D -i "${work}/profile.mobileprovision" > "${work}/profile.plist"
plist_get() { /usr/libexec/PlistBuddy -c "Print :$1" "${work}/profile.plist" 2> /dev/null || true; }

profile_uuid="$(plist_get UUID)"
profile_name="$(plist_get Name)"
profile_team="$(plist_get TeamIdentifier:0)"
profile_app_id="$(plist_get Entitlements:application-identifier)"
profile_attest="$(plist_get Entitlements:com.apple.developer.devicecheck.appattest-environment)"
profile_get_task_allow="$(plist_get Entitlements:get-task-allow)"
profile_has_devices="$(plist_get ProvisionedDevices:0)"
profile_all_devices="$(plist_get ProvisionsAllDevices)"

fail=0
if [ -z "$profile_uuid" ]; then
  echo "::error::Provisioning profile has no UUID"
  exit 1
fi
if [ "$profile_team" != "$APPLE_TEAM_ID" ]; then
  echo "::error::Provisioning profile team does not match APPLE_TEAM_ID"
  fail=1
fi
if [ "$profile_app_id" != "${APPLE_TEAM_ID}.${BUNDLE_ID}" ]; then
  echo "::error::Provisioning profile is not for ${BUNDLE_ID}"
  fail=1
fi
# Apple lists this entitlement as a string or an array of allowed values.
case "$profile_attest" in
  *production*) ;;
  *)
    echo "::error::Provisioning profile lacks the App Attest capability (production)"
    fail=1
    ;;
esac
if [ "$profile_get_task_allow" = "true" ] || [ -n "$profile_has_devices" ] ||
  [ "$profile_all_devices" = "true" ]; then
  echo "::error::Provisioning profile is not an App Store distribution profile"
  fail=1
fi
[ "$fail" -eq 0 ] || exit 1

# Record the UUID first so cleanup can remove the profile even if a copy fails.
{
  printf 'PROFILE_UUID=%q\n' "$profile_uuid"
  printf 'PROFILE_NAME=%q\n' "$profile_name"
} > "${work}/profile.env"

# Xcode 16+ reads UserData; older tools read MobileDevice. Install to both.
for dir in "$HOME/Library/Developer/Xcode/UserData/Provisioning Profiles" \
  "$HOME/Library/MobileDevice/Provisioning Profiles"; do
  mkdir -p "$dir"
  cp "${work}/profile.mobileprovision" "${dir}/${profile_uuid}.mobileprovision"
done
rm -f "${work}/profile.plist"

echo "Installed provisioning profile \"${profile_name}\" (${profile_uuid})"
