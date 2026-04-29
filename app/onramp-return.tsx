import { router, useLocalSearchParams } from "expo-router";
import { useEffect } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { COLORS } from "../constants/Colors";

/**
 * Dummy landing screen for onramp redirectUrl deep link testing.
 *
 * When the Coinbase onramp widget completes a transaction it redirects to
 * onrampdemo://onramp-return (set as redirectUrl in the session payload).
 * iOS opens this screen via the deep link scheme registered in app.config.ts.
 *
 * This is a test screen — swap out the body once you know what data
 * Coinbase appends to the redirect URL (e.g. transaction ID, status).
 */
export default function OnrampReturn() {
  const params = useLocalSearchParams();

  useEffect(() => {
    console.log('🔗 [ONRAMP RETURN] Deep link received, params:', params);
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.CARD_BG, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <ActivityIndicator color={COLORS.BLUE} size="large" style={{ marginBottom: 24 }} />
      <Text style={{ color: COLORS.TEXT_PRIMARY, fontSize: 20, fontWeight: '600', marginBottom: 12 }}>
        Onramp Complete
      </Text>
      <Text style={{ color: COLORS.TEXT_SECONDARY, fontSize: 14, textAlign: 'center', marginBottom: 8 }}>
        Redirect received from Coinbase widget.
      </Text>
      <Text style={{ color: COLORS.TEXT_SECONDARY, fontSize: 12, fontFamily: 'monospace', textAlign: 'center', marginBottom: 32 }}>
        {JSON.stringify(params, null, 2)}
      </Text>
      <Text
        style={{ color: COLORS.BLUE, fontSize: 14, fontWeight: '600' }}
        onPress={() => router.replace('/(tabs)')}
      >
        Back to Home
      </Text>
    </View>
  );
}
