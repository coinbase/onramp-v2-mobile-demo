import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { WebView } from "react-native-webview";
import { COLORS } from "../../constants/Colors";
import { addWebViewEvent } from "../../utils/sharedState";

const { BLUE, CARD_BG, BORDER, TEXT_PRIMARY, TEXT_SECONDARY, WHITE } = COLORS;

type TransactionStatus = "pending" | "success" | "error" | null;
type AlertType = "success" | "error" | "info";

function addSandboxPaymentParam(url: string, isSandbox: boolean): string {
  if (!isSandbox) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}useApplePaySandbox=true`;
}

/**
 * Visible hosted surface for private-beta Embedded Orders. Coinbase owns phone,
 * email, OTP, limits, and payment UI. Unlike the classic API widget, this
 * component never injects a click: the user must initiate the payment gesture.
 */
export function EmbeddedOrderWidget({
  visible,
  paymentUrl,
  isSandbox,
  onClose,
  setIsProcessingPayment,
  setTransactionStatus,
  onAlert,
}: {
  visible: boolean;
  paymentUrl: string;
  isSandbox: boolean;
  onClose: () => void;
  setIsProcessingPayment: (value: boolean) => void;
  setTransactionStatus: (status: TransactionStatus) => void;
  onAlert: (title: string, message: string, type: AlertType) => void;
}) {
  const webViewRef = useRef<WebView>(null);
  const closedRef = useRef(false);
  // Cache the last non-empty URL. The parent clears `paymentUrl` in the same
  // state update that flips `visible` to false; if this component reacted to
  // that by unmounting the <Modal> immediately (instead of letting `visible`
  // drive a normal close), the native modal gets torn out mid-dismissal and
  // can leave the screen underneath unresponsive. Keeping the last URL around
  // lets the Modal (and WebView) stay mounted for its own close transition.
  const [activeUrl, setActiveUrl] = useState(paymentUrl);
  useEffect(() => {
    if (paymentUrl) setActiveUrl(paymentUrl);
  }, [paymentUrl]);

  const finalUrl = useMemo(() => addSandboxPaymentParam(activeUrl, isSandbox), [activeUrl, isSandbox]);

  useEffect(() => {
    if (visible) closedRef.current = false;
  }, [visible, paymentUrl]);

  const close = useCallback(() => {
    if (closedRef.current) return;
    closedRef.current = true;
    setIsProcessingPayment(false);
    onClose();
  }, [onClose, setIsProcessingPayment]);

  const handleMessage = useCallback(({ nativeEvent }: { nativeEvent: { data: string } }) => {
    try {
      const message = JSON.parse(nativeEvent.data);
      const eventName = message?.eventName as string | undefined;
      if (!eventName) return;

      addWebViewEvent({
        eventName,
        timestamp: new Date().toISOString(),
        paymentMethod: "Embedded Order",
        data: message.data,
      });

      const errorMessage = message.data?.errorMessage || "The hosted onramp flow could not continue.";
      switch (eventName) {
        case "onramp_api.verification_success":
          onAlert("Contact verified", "Your phone and email are verified. Continuing to the next step.", "info");
          break;
        case "onramp_api.upgrade_submit_success":
          onAlert("Limits submitted", "Coinbase received your limits-upgrade information.", "info");
          break;
        case "onramp_api.upgrade_approved":
          onAlert("Limits approved", "Your limits were approved. Continue to payment.", "success");
          break;
        case "onramp_api.commit_success":
          setTransactionStatus("pending");
          onAlert("Payment submitted", "Your payment was accepted. Waiting for crypto delivery.", "success");
          break;
        case "onramp_api.polling_success":
          setTransactionStatus("success");
          setIsProcessingPayment(false);
          onAlert("Complete", "Your crypto has been delivered to the selected destination.", "success");
          break;
        case "onramp_api.polling_error":
          setTransactionStatus("error");
          setIsProcessingPayment(false);
          onAlert("Transaction failed", errorMessage, "error");
          break;
        case "onramp_api.session_error":
          setTransactionStatus("error");
          onAlert("Embedded order ended", errorMessage, "error");
          close();
          break;
        case "onramp_api.load_error":
        case "onramp_api.commit_error":
          setTransactionStatus("error");
          setIsProcessingPayment(false);
          onAlert("Payment error", errorMessage, "error");
          break;
        case "onramp_api.cancel":
          close();
          break;
        default:
          break;
      }
    } catch {
      // Ignore non-Onramp WebView messages.
    }
  }, [close, onAlert, setIsProcessingPayment, setTransactionStatus]);

  if (!visible && !activeUrl) return null;

  return (
    <Modal visible={visible} transparent animationType="slide" presentationStyle="overFullScreen" onRequestClose={close}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFillObject} onPress={close} accessibilityLabel="Close embedded order" />
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text style={styles.title}>Coinbase Onramp</Text>
              <Text style={styles.subtitle}>Embedded Order{isSandbox ? " · Sandbox" : ""}</Text>
            </View>
            <Pressable onPress={close} style={styles.closeButton} accessibilityRole="button" accessibilityLabel="Close onramp">
              <Text style={styles.closeText}>Close</Text>
            </Pressable>
          </View>
          <WebView
            ref={webViewRef}
            source={{ uri: finalUrl }}
            onMessage={handleMessage}
            onError={({ nativeEvent }) => {
              setIsProcessingPayment(false);
              onAlert("Embedded order unavailable", nativeEvent.description || "The hosted page could not be loaded.", "error");
            }}
            javaScriptEnabled
            domStorageEnabled
            thirdPartyCookiesEnabled
            // react-native-webview keeps Apple Pay disabled on iOS unless this
            // dedicated flag is set. paymentRequestEnabled is the Android flag.
            // The hosted page already posts events through the native message
            // handler, so it does not depend on injected JavaScript.
            enableApplePay
            paymentRequestEnabled
            originWhitelist={["*"]}
            setSupportMultipleWindows={false}
            startInLoadingState
            style={styles.webView}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.5)" },
  sheet: { height: "75%", backgroundColor: CARD_BG, borderTopLeftRadius: 24, borderTopRightRadius: 24, overflow: "hidden" },
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 18, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: BORDER },
  headerCopy: { flex: 1 },
  title: { color: TEXT_PRIMARY, fontSize: 17, fontWeight: "600" },
  subtitle: { color: TEXT_SECONDARY, fontSize: 12, marginTop: 2 },
  closeButton: { backgroundColor: BLUE, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 8 },
  closeText: { color: WHITE, fontSize: 14, fontWeight: "600" },
  webView: { flex: 1 },
});
