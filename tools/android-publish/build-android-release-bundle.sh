#!/usr/bin/env bash
# Decode the upload keystore, point Gradle at it, and build the release AAB.
# versionCode is 30000000 plus whole minutes since 2026-01-01 UTC: unique per
# minute, above the old YYMMDDHH codes (26xxxxxx), and under Play's 2100000000 cap.
set -euo pipefail

umask 077
VERSION_CODE_BASE=30000000
VERSION_CODE_EPOCH=1767225600
export ANDROID_VERSION_CODE="$((VERSION_CODE_BASE + ($(date -u +%s) - VERSION_CODE_EPOCH) / 60))"
export ANDROID_KEYSTORE_FILE="${RUNNER_TEMP}/upload.keystore"

echo "$ANDROID_UPLOAD_KEYSTORE_BASE64" | base64 -d > "$ANDROID_KEYSTORE_FILE"
node tools/android-publish/sign-android-release.js

cd android
./gradlew bundleRelease --no-daemon
