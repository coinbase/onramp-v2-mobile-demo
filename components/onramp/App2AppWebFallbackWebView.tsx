/**
 * ============================================================================
 * App2AppWebFallbackWebView — iOS IN-APP WEB FALLBACK (COM2-3599)
 * ============================================================================
 *
 * When App2App is selected but the Coinbase retail app is not installed on
 * iOS, the demo mints an authed onramp widget session (POST /onramp/session)
 * and loads the returned URL in a visible in-app WebView — no App Attest.
 *
 * INTENTIONAL WebView choice (vs ASWebAuthenticationSession / openAuthSessionAsync):
 * This demo models a partner embedding Coinbase Onramp inside their own app
 * WebView when app-to-app hand-off is unavailable. WebView has auth limitations:
 * no WebAuthn/Passkey support and an isolated cookie store, so users may need
 * to sign in to Coinbase on each purchase.
 * ============================================================================
 */

import { useCallback, useEffect, useRef } from "react";
import {
  Modal,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { WebView } from "react-native-webview";
import { COLORS } from "../../constants/Colors";

const { CARD_BG, BORDER, TEXT_PRIMARY, TEXT_SECONDARY, BLUE, WHITE } = COLORS;

/** Deep link and https redirect targets that signal onramp completion. */
function isOnrampReturnUrl(url: string): boolean {
  if (url.startsWith("onrampdemo://")) return true;
  try {
    const parsed = new URL(url);
    return parsed.pathname.includes("/onramp-return");
  } catch {
    return url.includes("onramp-return");
  }
}

export interface App2AppWebFallbackWebViewProps {
  /** When true, presents the fullscreen WebView modal. */
  visible: boolean;
  /** Authed onramp widget URL from createWidgetSession. */
  url: string;
  /** User dismissed the WebView without completing. */
  onClose: () => void;
  /** Coinbase redirected to the app return URL — close WebView and navigate. */
  onComplete: (redirectUrl: string) => void;
}

export function App2AppWebFallbackWebView({
  visible,
  url,
  onClose,
  onComplete,
}: App2AppWebFallbackWebViewProps) {
  const webViewRef = useRef<WebView>(null);
  const completedRef = useRef(false);

  useEffect(() => {
    if (visible) completedRef.current = false;
  }, [visible, url]);

  const handleReturnUrl = useCallback(
    (redirectUrl: string) => {
      if (completedRef.current) return;
      completedRef.current = true;
      console.log("📱 [APP2APP WEB FALLBACK] Return URL intercepted:", redirectUrl);
      onComplete(redirectUrl);
    },
    [onComplete],
  );

  const interceptUrl = useCallback(
    (targetUrl: string | undefined): boolean => {
      if (!targetUrl || !isOnrampReturnUrl(targetUrl)) return false;
      handleReturnUrl(targetUrl);
      return true;
    },
    [handleReturnUrl],
  );

  if (!url) return null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={styles.title}>Coinbase Onramp</Text>
            <Text style={styles.subtitle}>
              App2App web fallback — authed widget session (iOS demo)
            </Text>
          </View>
          <Pressable
            onPress={onClose}
            style={({ pressed }) => [styles.closeButton, pressed && { opacity: 0.7 }]}
            accessibilityRole="button"
            accessibilityLabel="Close onramp"
          >
            <Text style={styles.closeButtonText}>Close</Text>
          </Pressable>
        </View>

        <WebView
          ref={webViewRef}
          style={styles.webView}
          source={{ uri: url }}
          onShouldStartLoadWithRequest={(request) => {
            if (interceptUrl(request.url)) return false;
            return true;
          }}
          onNavigationStateChange={(navState) => {
            interceptUrl(navState.url);
          }}
          onError={(syntheticEvent) => {
            console.error(
              "📱 [APP2APP WEB FALLBACK] WebView error:",
              syntheticEvent.nativeEvent.description,
            );
          }}
          javaScriptEnabled
          domStorageEnabled
          thirdPartyCookiesEnabled
          sharedCookiesEnabled
          originWhitelist={["*"]}
          setSupportMultipleWindows={false}
          startInLoadingState
        />
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: CARD_BG,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    gap: 12,
  },
  headerText: {
    flex: 1,
  },
  title: {
    fontSize: 17,
    fontWeight: "600",
    color: TEXT_PRIMARY,
  },
  subtitle: {
    fontSize: 12,
    color: TEXT_SECONDARY,
    marginTop: 2,
    lineHeight: 16,
  },
  closeButton: {
    backgroundColor: BLUE,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
  },
  closeButtonText: {
    color: WHITE,
    fontSize: 14,
    fontWeight: "600",
  },
  webView: {
    flex: 1,
  },
});
