import { handleOnrampReturn } from "@coinbase/cdp-react-native";
import * as Linking from "expo-linking";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { COLORS } from "../constants/Colors";

/**
 * Landing screen for onramp redirectUrl deep links.
 *
 * When the Coinbase onramp widget / app2app flow completes it redirects to
 * onrampdemo://onramp-return (or the https Universal Link equivalent set as
 * redirectUrl in the session payload). iOS opens this screen via the deep
 * link scheme / associated domain registered in app.config.ts.
 *
 * Calls {@link handleOnrampReturn} with the return URL so the SDK can run the
 * post-redirect security handshake once the backend starts issuing nonces.
 * Today that call is a no-op; keep it for forward compatibility.
 */
export default function OnrampReturn() {
  const params = useLocalSearchParams();
  const url = Linking.useURL();

  const queryParams = useMemo(() => {
    const fromRouter: Record<string, string> = {};
    for (const [key, value] of Object.entries(params)) {
      if (value == null) continue;
      fromRouter[key] = Array.isArray(value) ? value.join(", ") : String(value);
    }

    if (url) {
      try {
        const parsed = Linking.parse(url);
        for (const [key, value] of Object.entries(parsed.queryParams ?? {})) {
          if (value == null) continue;
          fromRouter[key] = Array.isArray(value) ? value.join(", ") : String(value);
        }
      } catch {
        // keep router params only
      }
    }

    return fromRouter;
  }, [params, url]);

  const entries = Object.entries(queryParams);

  useEffect(() => {
    console.log("🔗 [ONRAMP RETURN] Deep link received");
    console.log("🔗 [ONRAMP RETURN] useLocalSearchParams:", params);
    console.log("🔗 [ONRAMP RETURN] raw redirectUrl:", url);
    console.log("🔗 [ONRAMP RETURN] query params:", queryParams);
    for (const [key, value] of Object.entries(queryParams)) {
      console.log(`🔗 [ONRAMP RETURN]   ${key}=${JSON.stringify(value)}`);
    }

    // Forward-compatible: no-op today; will finalize the session handshake
    // when Coinbase embeds a nonce in the redirect URL.
    if (url) {
      handleOnrampReturn({ returnUrl: url }).catch((err) => {
        console.error("🔗 [ONRAMP RETURN] handleOnrampReturn failed:", err);
      });
    }
  }, [url, params, queryParams]);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Onramp Complete</Text>
      <Text style={styles.subtitle}>Redirect query params</Text>

      <ScrollView
        style={styles.list}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
      >
        {entries.length === 0 ? (
          <Text style={styles.empty}>No query params on redirect URL</Text>
        ) : (
          entries.map(([key, value]) => (
            <View key={key} style={styles.row}>
              <Text style={styles.key}>{key}</Text>
              <Text style={styles.value} selectable>
                {value}
              </Text>
            </View>
          ))
        )}
      </ScrollView>

      {url ? (
        <Text style={styles.rawUrl} selectable numberOfLines={3}>
          {url}
        </Text>
      ) : null}

      <Text style={styles.back} onPress={() => router.replace("/(tabs)")}>
        Back to Home
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.CARD_BG,
    paddingHorizontal: 24,
    paddingTop: 72,
    paddingBottom: 40,
  },
  title: {
    color: COLORS.TEXT_PRIMARY,
    fontSize: 20,
    fontWeight: "600",
    marginBottom: 8,
  },
  subtitle: {
    color: COLORS.TEXT_SECONDARY,
    fontSize: 14,
    marginBottom: 20,
  },
  list: {
    flexGrow: 0,
    maxHeight: "60%",
  },
  listContent: {
    gap: 12,
    paddingBottom: 8,
  },
  row: {
    borderWidth: 1,
    borderColor: COLORS.BORDER,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 4,
  },
  key: {
    color: COLORS.TEXT_SECONDARY,
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  value: {
    color: COLORS.TEXT_PRIMARY,
    fontSize: 15,
    fontFamily: "monospace",
  },
  empty: {
    color: COLORS.TEXT_SECONDARY,
    fontSize: 14,
    fontStyle: "italic",
  },
  rawUrl: {
    marginTop: 20,
    color: COLORS.TEXT_SECONDARY,
    fontSize: 11,
    fontFamily: "monospace",
  },
  back: {
    marginTop: "auto",
    color: COLORS.BLUE,
    fontSize: 14,
    fontWeight: "600",
    textAlign: "center",
    paddingVertical: 12,
  },
});
