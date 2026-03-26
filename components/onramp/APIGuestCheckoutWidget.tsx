import { useEffect, useRef } from "react";
import { WebView } from "react-native-webview";

/**
 * Shared Guest Checkout WebView Widget for Apple Pay (iOS) and Google Pay (Android).
 *
 * Orchestrates the payment flow via a behind-the-scenes WebView:
 *
 * 1. Loads the Coinbase hosted payment page (paymentLink URL from Create Order API)
 * 2. On load_success (page event), auto-clicks the native pay button
 * 3. What happens next depends on the mode:
 *
 *    PRODUCTION (isSandbox=false):
 *      Native payment sheet appears (Apple Pay on iOS, Google Pay on Android).
 *      User confirms on the native sheet.
 *
 *    SANDBOX (isSandbox=true):
 *      partnerUserRef is prefixed with "sandbox-" (handled by useOnramp).
 *      URL gets useApplePaySandbox=true or useGooglePaySandbox=true appended.
 *      Transaction completes automatically without real funds.
 *
 * 4. All transaction lifecycle events are dispatched by the payment page itself
 *    via postMessage. We only consume and log them.
 */

const PAYMENT_CONFIG = {
  GUEST_CHECKOUT_APPLE_PAY: {
    buttonId: 'api-onramp-apple-pay-button',
    hideCSS: 'apple-pay-button { display: none !important; }',
    label: 'Apple Pay',
    sandboxParam: 'useApplePaySandbox',
  },
  GUEST_CHECKOUT_GOOGLE_PAY: {
    buttonId: 'gpay-button-online-api-id',
    hideCSS: '#api-onramp-google-pay-button { visibility: hidden !important; height: 0 !important; overflow: hidden !important; }',
    label: 'Google Pay',
    sandboxParam: 'useGooglePaySandbox',
  },
} as const;

type GuestCheckoutMethod = keyof typeof PAYMENT_CONFIG;

export function APIGuestCheckoutWidget({
  paymentUrl,
  paymentMethod,
  onClose,
  setIsProcessingPayment,
  setTransactionStatus,
  onAlert,
  isSandbox = false,
}: {
  paymentUrl: string;
  paymentMethod: GuestCheckoutMethod;
  onClose?: () => void;
  setIsProcessingPayment?: (loading: boolean) => void;
  setTransactionStatus?: (status: 'pending' | 'success' | 'error' | null) => void;
  onAlert?: (title: string, message: string, type: 'success' | 'error' | 'info') => void;
  isSandbox?: boolean;
}) {
  const webViewRef = useRef<WebView>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const config = PAYMENT_CONFIG[paymentMethod] ?? PAYMENT_CONFIG.GUEST_CHECKOUT_APPLE_PAY;
  const finalUrl = paymentUrl;
  const sandboxPrefix = isSandbox ? '[SANDBOX] ' : '';

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  if (!paymentUrl) return null;

  const hiddenStyle = {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: -1,
    opacity: 0,
  };

  const injectPayButtonClick = () => {
    console.log(`[${config.label}] Injecting pay button click (button: ${config.buttonId})`);
    webViewRef.current?.injectJavaScript(`
      (function() {
        var style = document.createElement('style');
        style.textContent = \`${config.hideCSS}\`;
        document.head.appendChild(style);

        // Log Google Pay gateway merchant ID from the page
        try {
          // Check for NEXT_PUBLIC env vars exposed on window.__NEXT_DATA__ or window.__ENV__
          var nextData = window.__NEXT_DATA__;
          if (nextData && nextData.runtimeConfig) {
            window.ReactNativeWebView.postMessage(JSON.stringify({
              eventName: 'debug.next_config',
              data: nextData.runtimeConfig
            }));
          }
          if (nextData && nextData.props && nextData.props.pageProps) {
            window.ReactNativeWebView.postMessage(JSON.stringify({
              eventName: 'debug.page_props',
              data: nextData.props.pageProps
            }));
          }

          // Intercept Google Pay loadPaymentData to capture the full request
          if (window.google && window.google.payments && window.google.payments.api) {
            var OrigClient = window.google.payments.api.PaymentsClient;
            var origProto = OrigClient.prototype.loadPaymentData;
            OrigClient.prototype.loadPaymentData = function(req) {
              window.ReactNativeWebView.postMessage(JSON.stringify({
                eventName: 'debug.gpay_payment_request',
                data: JSON.parse(JSON.stringify(req))
              }));
              return origProto.apply(this, arguments);
            };
          }

          // Also scan script tags and meta tags for merchant IDs
          var scripts = document.querySelectorAll('script');
          scripts.forEach(function(s) {
            var text = s.textContent || '';
            if (text.includes('gatewayMerchantId') || text.includes('CHECKOUT_COM') || text.includes('checkout.com')) {
              var match = text.match(/gatewayMerchantId['":\\s]+['"]([^'"]+)['"]/);
              if (match) {
                window.ReactNativeWebView.postMessage(JSON.stringify({
                  eventName: 'debug.gateway_merchant_id',
                  data: { gatewayMerchantId: match[1], source: 'script_tag' }
                }));
              }
            }
          });
        } catch(e) {
          window.ReactNativeWebView.postMessage(JSON.stringify({
            eventName: 'debug.extraction_error',
            data: { error: e.message }
          }));
        }

        function tryClick(attempt) {
          var btn = document.getElementById('${config.buttonId}');
          if (btn) {
            btn.click();
          } else if (attempt < 10) {
            setTimeout(function() { tryClick(attempt + 1); }, 500);
          }
        }
        tryClick(1);
      })();
      true;
    `);
  };

  console.log(`[${config.label}] Loading URL: ${finalUrl}`);

  const webView = (
    <WebView
      ref={webViewRef}
      style={hiddenStyle}
      onLoadStart={() => {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        console.log(`[${config.label}] WebView loading, starting 60s timeout...`);
        timeoutRef.current = setTimeout(() => {
          console.log(`[${config.label}] Timeout — resetting state`);
          onAlert?.("Payment Timeout", "The payment process took too long. Please try again.", 'error');
          setIsProcessingPayment?.(false);
          onClose?.();
        }, 60000);
      }}
      onError={(syntheticEvent) => {
        const { nativeEvent } = syntheticEvent;
        console.error(`[${config.label}] WebView error:`, nativeEvent.description);
      }}
      onHttpError={(syntheticEvent) => {
        const { nativeEvent } = syntheticEvent;
        console.error(`[${config.label}] HTTP error:`, nativeEvent.statusCode, nativeEvent.url);
      }}
      onMessage={({ nativeEvent }) => {
        try {
          const data = JSON.parse(nativeEvent.data);
          const { eventName } = data;
          console.log(`[${config.label}] ${eventName}`, JSON.stringify(data.data ?? '', null, 2));

          if (eventName?.startsWith('debug.')) {
            console.log(`🔍 [DEBUG] ${eventName}:`, JSON.stringify(data.data, null, 2));
            return;
          }

          switch (eventName) {
            case "onramp_api.load_pending":
              break;

            case "onramp_api.load_success":
              injectPayButtonClick();
              break;

            case "onramp_api.cancel":
              onAlert?.(`${sandboxPrefix}Payment Cancelled`, "The payment was cancelled by the user", 'info');
              setIsProcessingPayment?.(false);
              onClose?.();
              break;

            case "onramp_api.commit_error":
            case "onramp_api.load_error":
              onAlert?.(
                `${sandboxPrefix}Payment Error`,
                `The payment failed: ${data.data?.errorCode} - ${data.data?.errorMessage}`,
                'error'
              );
              setIsProcessingPayment?.(false);
              onClose?.();
              break;

            case "onramp_api.commit_success":
              if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
                timeoutRef.current = null;
              }
              setTransactionStatus?.('pending');
              onAlert?.(
                `${sandboxPrefix}Payment Successful!`,
                "Your payment has been processed. We're now delivering your crypto to your wallet.",
                'success'
              );
              break;

            case "onramp_api.polling_start":
              timeoutRef.current = setTimeout(() => {
                onAlert?.(
                  "Delivery Taking Longer",
                  "Your payment was successful, but crypto delivery is taking longer than expected.",
                  'info'
                );
              }, 300000);
              break;

            case "onramp_api.polling_success":
              if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
                timeoutRef.current = null;
              }
              setTransactionStatus?.('success');
              onAlert?.(`${sandboxPrefix}Complete!`, "Your crypto has been delivered to your wallet!", 'success');
              setTimeout(() => onClose?.(), 2000);
              break;

            case "onramp_api.polling_error":
              if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
                timeoutRef.current = null;
              }
              setTransactionStatus?.('error');
              onAlert?.(
                `${sandboxPrefix}Transaction Failed`,
                `There was an issue: ${data.data?.errorCode} - ${data.data?.errorMessage}`,
                'error'
              );
              setTimeout(() => onClose?.(), 2000);
              break;

            default:
              break;
          }
        } catch (error) {
          if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
          }
          console.error('Error parsing WebView message:', error);
        }
      }}
      source={{ uri: finalUrl }}
      startInLoadingState={false}
      javaScriptEnabled={true}
      domStorageEnabled={true}
      thirdPartyCookiesEnabled={true}
      sharedCookiesEnabled={true}
      allowsInlineMediaPlayback={true}
      mixedContentMode="compatibility"
      originWhitelist={['*']}
      setSupportMultipleWindows={false}
      javaScriptCanOpenWindowsAutomatically={true}
      paymentRequestEnabled={true}
    />
  );

  return webView;
}
