#!/usr/bin/env bash
# Archive the prebuilt iOS app with manual App Store signing and export a
# signed IPA to $RUNNER_TEMP/ios-build/export. Fails if the exported app lost
# the production App Attest entitlement during signing.
set -euo pipefail

BUNDLE_ID="com.coinbase.cdp-onramp"
signing="${RUNNER_TEMP}/ios-signing"
build="${RUNNER_TEMP}/ios-build"
mkdir -p "$build"

# shellcheck source=/dev/null
. "${signing}/profile.env"

bundle exec ruby tools/ios-publish/configure-ios-signing.rb "$APPLE_TEAM_ID" "$PROFILE_UUID"

set +e
xcodebuild archive \
  -workspace ios/OnrampV2Demo.xcworkspace \
  -scheme OnrampV2Demo \
  -configuration Release \
  -destination "generic/platform=iOS" \
  -archivePath "${build}/OnrampV2Demo.xcarchive" \
  OTHER_CODE_SIGN_FLAGS="--keychain ${signing}/signing.keychain-db" \
  > "${build}/archive.log" 2>&1
archive_status=$?
set -e
grep -E '^\*\* ' "${build}/archive.log" || true
if [ "$archive_status" -ne 0 ]; then
  grep -E 'error:' "${build}/archive.log" | head -n 40 || true
  tail -n 60 "${build}/archive.log"
  echo "::error::xcodebuild archive failed"
  exit 1
fi

cat > "${build}/ExportOptions.plist" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key>
  <string>app-store-connect</string>
  <key>destination</key>
  <string>export</string>
  <key>signingStyle</key>
  <string>manual</string>
  <key>teamID</key>
  <string>${APPLE_TEAM_ID}</string>
  <key>signingCertificate</key>
  <string>Apple Distribution</string>
  <key>provisioningProfiles</key>
  <dict>
    <key>${BUNDLE_ID}</key>
    <string>${PROFILE_UUID}</string>
  </dict>
  <key>manageAppVersionAndBuildNumber</key>
  <false/>
  <key>uploadSymbols</key>
  <true/>
</dict>
</plist>
PLIST

xcodebuild -exportArchive \
  -archivePath "${build}/OnrampV2Demo.xcarchive" \
  -exportOptionsPlist "${build}/ExportOptions.plist" \
  -exportPath "${build}/export"

ipa="$(find "${build}/export" -maxdepth 1 -name '*.ipa' | head -n 1)"
if [ -z "$ipa" ]; then
  echo "::error::No IPA was exported"
  exit 1
fi

# Confirm the signed app still carries the production App Attest entitlement.
check="${build}/ipa-check"
rm -rf "$check"
mkdir -p "$check"
unzip -q "$ipa" -d "$check"
app="$(find "${check}/Payload" -maxdepth 1 -name '*.app' | head -n 1)"
if [ -z "$app" ]; then
  echo "::error::Exported IPA has no app in Payload"
  exit 1
fi
codesign -d --entitlements - --xml "$app" 2> /dev/null > "${check}/entitlements.plist"
attest="$(/usr/libexec/PlistBuddy -c 'Print :com.apple.developer.devicecheck.appattest-environment' \
  "${check}/entitlements.plist" 2> /dev/null || true)"
if [ "$attest" != "production" ]; then
  echo "::error::Signed app is missing the production App Attest entitlement"
  exit 1
fi
version="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "${app}/Info.plist")"
build_number="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "${app}/Info.plist")"
rm -rf "$check"

echo "IOS_IPA_PATH=${ipa}" >> "${GITHUB_ENV:-/dev/null}"
echo "Exported ${BUNDLE_ID} ${version} (${build_number}) with App Attest production"
