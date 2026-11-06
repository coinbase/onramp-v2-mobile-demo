#!/usr/bin/env bash
# Decode the upload keystore, point Gradle at it, and build the release AAB.
# versionCode is YYMMDDHH UTC so it stays under Play's 2100000000 cap.
set -euo pipefail

umask 077
export ANDROID_VERSION_CODE="$(date -u +%y%m%d%H)"
export ANDROID_KEYSTORE_FILE="${RUNNER_TEMP}/upload.keystore"

echo "$ANDROID_UPLOAD_KEYSTORE_BASE64" | base64 -d > "$ANDROID_KEYSTORE_FILE"
node tools/android-publish/sign-android-release.js

cd android
./gradlew bundleRelease --no-daemon
