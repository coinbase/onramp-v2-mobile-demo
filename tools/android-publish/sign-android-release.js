/**
 * Point a freshly prebuilt android/app/build.gradle at the Play upload key.
 * Expo's template signs release with the debug keystore. Play rejects that.
 *
 * Reads ANDROID_VERSION_CODE, ANDROID_KEYSTORE_FILE, ANDROID_KEYSTORE_PASSWORD,
 * ANDROID_KEY_ALIAS, and ANDROID_KEY_PASSWORD. Does not print their values.
 */
const fs = require("fs");

const gradlePath = "android/app/build.gradle";
const versionCode = process.env.ANDROID_VERSION_CODE || "";
const keystoreFile = process.env.ANDROID_KEYSTORE_FILE || "";

if (!/^\d+$/.test(versionCode)) {
  console.error("ANDROID_VERSION_CODE must be an integer");
  process.exit(1);
}
if (!keystoreFile) {
  console.error("ANDROID_KEYSTORE_FILE is required");
  process.exit(1);
}

const releaseSigning = `        release {
            storeFile file(System.getenv("ANDROID_KEYSTORE_FILE"))
            storePassword System.getenv("ANDROID_KEYSTORE_PASSWORD")
            keyAlias System.getenv("ANDROID_KEY_ALIAS")
            keyPassword System.getenv("ANDROID_KEY_PASSWORD")
        }`;

const debugCaution = `            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
            signingConfig signingConfigs.debug`;

let gradle = fs.readFileSync(gradlePath, "utf8");

if (!gradle.includes("keyAlias 'androiddebugkey'")) {
  console.error("android/app/build.gradle is not the Expo debug-signed template");
  process.exit(1);
}
if (!gradle.includes(debugCaution)) {
  console.error("release buildType is not signed with the debug config");
  process.exit(1);
}

gradle = gradle.replace(/versionCode \d+/, `versionCode ${versionCode}`);
gradle = gradle.replace(
  "keyPassword 'android'\n        }\n    }",
  `keyPassword 'android'\n        }\n${releaseSigning}\n    }`,
);
gradle = gradle.replace(debugCaution, "            signingConfig signingConfigs.release");

fs.writeFileSync(gradlePath, gradle);
console.log(`release signing configured, versionCode ${versionCode}`);
