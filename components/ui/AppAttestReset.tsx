/**
 * ============================================================================
 * AppAttestReset — CLEAR DEVICE ATTESTATION STATE (iOS)
 * ============================================================================
 *
 * Small maintenance control that wipes the stored App Attest keyId + attested /
 * registered markers (see utils/appAttest → clearAllAppAttestKeys). These live
 * in the iOS keychain and persist across app delete/reinstall for the same
 * bundle id, so a key provisioned during local/dev testing can be reused — and
 * then rejected at the per-transaction assertion (signature) step — by a later
 * TestFlight build. Tapping this forces a fresh attest + registration on the
 * next app2app run. iOS-only; renders nothing elsewhere.
 * ============================================================================
 */

import { clearOnrampAttestation } from "@coinbase/cdp-app-attest";
import React, { useState } from "react";
import { Alert, Platform, Pressable, StyleSheet, Text } from "react-native";
import { COLORS } from "../../constants/Colors";

const { TEXT_SECONDARY, BORDER } = COLORS;

export function AppAttestReset() {
  const [busy, setBusy] = useState(false);

  if (Platform.OS !== "ios") return null;

  const onReset = () => {
    Alert.alert(
      "Reset device attestation?",
      "Clears the stored App Attest key so the next app-to-app run provisions a fresh one. Use this if you see a signature/attestation error.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Reset",
          style: "destructive",
          onPress: async () => {
            setBusy(true);
            try {
              await clearOnrampAttestation();
              Alert.alert(
                "Attestation cleared",
                "A fresh key will be created on your next app-to-app attempt.",
              );
            } catch {
              Alert.alert(
                "Reset failed",
                "Could not clear the stored attestation key. Please try again.",
              );
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  };

  return (
    <Pressable
      onPress={onReset}
      disabled={busy}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
      accessibilityRole="button"
    >
      <Text style={styles.text}>
        {busy ? "Resetting…" : "Reset device attestation"}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignSelf: "center",
    paddingVertical: 8,
    paddingHorizontal: 14,
    marginTop: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: BORDER,
  },
  pressed: {
    opacity: 0.6,
  },
  text: {
    fontSize: 12,
    color: TEXT_SECONDARY,
    fontWeight: "600",
  },
});
