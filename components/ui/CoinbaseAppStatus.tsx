/**
 * ============================================================================
 * CoinbaseAppStatus — RETAIL APP INSTALL INDICATOR
 * ============================================================================
 *
 * Minimal banner that shows whether the Coinbase retail app is installed on the
 * device. Demonstrates the partner detection step (see useCoinbaseAppInstalled):
 * partners can use this signal to choose app-to-app hand-off vs a web fallback.
 * ============================================================================
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { COLORS } from "../../constants/Colors";
import {
  CoinbaseAppInstallState,
  useCoinbaseAppInstalled,
} from "../../hooks/useCoinbaseAppInstalled";

const { CARD_BG, BORDER, TEXT_PRIMARY, TEXT_SECONDARY } = COLORS;

const STATUS_DETAILS: Record<
  CoinbaseAppInstallState,
  { dotColor: string; label: string; hint: string }
> = {
  unknown: {
    dotColor: "#B8C9C8",
    label: "Checking for Coinbase app…",
    hint: "Detecting whether the Coinbase retail app is installed.",
  },
  installed: {
    dotColor: "#4ADE80",
    label: "Coinbase app installed",
    hint: "App-to-app hand-off is available on this device.",
  },
  "not-installed": {
    dotColor: "#FF7800",
    label: "Coinbase app not installed",
    hint: "Falls back to the web onramp flow.",
  },
};

export function CoinbaseAppStatus() {
  const { state } = useCoinbaseAppInstalled();
  const { dotColor, label, hint } = STATUS_DETAILS[state];

  return (
    <View style={styles.container} accessibilityRole="text">
      <View style={[styles.dot, { backgroundColor: dotColor }]} />
      <View style={styles.textContainer}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.hint}>{hint}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    padding: 16,
    marginHorizontal: 20,
    marginTop: 16,
    gap: 12,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  textContainer: {
    flex: 1,
  },
  label: {
    fontSize: 16,
    fontWeight: "600",
    color: TEXT_PRIMARY,
    marginBottom: 2,
  },
  hint: {
    fontSize: 12,
    color: TEXT_SECONDARY,
    lineHeight: 16,
  },
});
