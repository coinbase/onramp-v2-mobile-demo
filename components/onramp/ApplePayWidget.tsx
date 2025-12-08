import { useEffect, useRef } from "react";
import { WebView } from "react-native-webview";

/**
 * CRITICAL: Apple Pay Webview Event Flow
 *
 * This component orchestrates the entire payment process:
 *
 * - onramp_api.load_success: Page loaded → Auto-hide & click Apple Pay button
 * - onramp_api.commit_success: Payment authorized by user → start blockchain tracking
 * - onramp_api.polling_start: Begin tracking blockchain transaction
 * - onramp_api.polling_success: Crypto delivered to wallet → show success
 * - onramp_api.polling_error: Transaction failed on blockchain → show error
 * - onramp_api.cancel: User cancels payment → show info
 * - onramp_api.load_error: Page load fails → show error
 * - onramp_api.commit_error: Payment authorization fails → show error
 *
 * These post events ensure smooth execution of the payment process from start to finish.
 *
 * The WebView is hidden (1x1px, off-screen) but functional.
 * All user interaction happens through native Apple Pay sheet.
 *
 * POST-EVENT TIMING & EXPECTED FLOW:
 *
 * Normal success flow (with times):
 * 1. onramp_api.load_success (~2s after mount)
 *    → Hides button, auto-clicks, shows Apple Pay sheet
 *
 * 2. User authorizes payment in Apple Pay sheet (~10-30s)
 *
 * 3. onramp_api.commit_success (immediately after authorization)
 *    → Shows "Payment Successful!" alert
 *    → Clears 30s timeout
 *    → Starts 5min blockchain delivery timeout
 *
 * 4. onramp_api.polling_start (~1-2s after commit)
 *    → Backend begins tracking blockchain transaction
 *
 * 5. onramp_api.polling_success (~30s-2min after polling start)
 *    → Crypto delivered to wallet
 *    → Shows "Complete!" alert
 *    → Auto-closes after 2s
 *
 * Error scenarios:
 * - User cancels Apple Pay sheet → onramp_api.cancel (anytime)
 * - Payment card declined → onramp_api.commit_error (during authorization)
 * - Blockchain network issue → onramp_api.polling_error (during delivery)
 * - Timeout (30s) → Shows timeout alert, stops processing
 *
 * TIMEOUT STRATEGY:
 * - 30s timeout for payment authorization (load → commit)
 * - 5min timeout for blockchain delivery (commit → polling success)
 * - Timeouts are cleared on success/error events
 * - Payment success timeout does NOT close widget (let polling continue)
 *
 * HIDDEN WEBVIEW TECHNIQUE:
 * - WebView is 1x1 pixel, positioned off-screen (-1000px)
 * - Opacity 0 (fully transparent)
 * - Still functional (loads page, runs JS, receives events)
 * - Native Apple Pay sheet is shown by iOS (triggered by button click)
 * - User never sees the webpage, only native payment UI
 *
 * WHY forceFeature=true?
 * - Demo/testing parameter for Coinbase sandbox
 * - Remove this in production code (use original paymentUrl)
 * - Ensures feature is enabled regardless of sandbox/prod mode
 */
export function ApplePayWidget({
  paymentUrl,
  onClose,
  setIsProcessingPayment,
  setTransactionStatus,
  onAlert,
  isSandbox = false
}: {
  paymentUrl: string;
  onClose?: () => void;
  setIsProcessingPayment?: (loading: boolean) => void;
  setTransactionStatus?: (status: 'pending' | 'success' | 'error' | null) => void;
  onAlert?: (title: string, message: string, type: 'success' | 'error' | 'info') => void;
  isSandbox?: boolean; // Indicates sandbox mode (partnerUserRef prefixed with "sandbox-")
}) {
  const webViewRef = useRef<WebView>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null); // Add timeout ref

  // const finalUrl = `${paymentUrl}`;
  // CRITICAL: forceFeature used for demo purposes; Use original paymentLink like above for production code
  const finalUrl = `${paymentUrl}&forceFeature=true`;

  // Sandbox prefix for alerts
  const sandboxPrefix = isSandbox ? '[SANDBOX] ' : ''; 

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  // Don't render anything if not visible or no URL
  // onClose, this will close WebView and stop listening to post-event messages
  if (!paymentUrl) {
    return null;
  }

  return (
    <WebView
      // Hidden WebView (1x1 pixel, off-screen) - only for functionality
      ref={webViewRef}
      style={{
        width: 1,
        height: 1,
        position: 'absolute',
        left: -1000,
        top: -1000,
        opacity: 0,
      }}
      onLoadStart={() => {
        // Start timeout when WebView begins loading
        console.log('WebView started loading, starting 30s timeout...');
        timeoutRef.current = setTimeout(() => {
          console.log('Payment timeout - resetting state');
          onAlert?.("Payment Timeout", "The payment process took too long. Please try again.", 'error');
          setIsProcessingPayment?.(false);
          onClose?.();
        }, 60000); // 30 second timeout
      }}

      onMessage={({ nativeEvent }) => {
        try {
          const data = JSON.parse(nativeEvent.data);

          // Handle Coinbase events
          const { eventName } = data;
          console.log(eventName);

          switch (eventName) {
            case "onramp_api.load_pending":
              console.log('Coinbase v2 API loading...');
              break;
              
              case "onramp_api.load_success":
                // Inject CSS to hide button + JavaScript to click it automatically
                console.log('Coinbase v2 API loaded successfully, Apple Pay button ready');
                webViewRef.current?.injectJavaScript(`
                  const style = document.createElement('style');
                  style.textContent = \`
                    apple-pay-button {
                      display: none !important;
                    }
                  \`;
                  document.head.appendChild(style);
                  
                  // Click the hidden button
                  const btn = document.getElementById('api-onramp-apple-pay-button');
                  console.log('Apple Pay button found', btn);
                  if (btn) btn.click();
                  console.log('Apple Pay button hidden & clicked');
                `);
                break;
              
            case "onramp_api.cancel":
              console.log('User cancels Apple pop-up');
              onAlert?.(`${sandboxPrefix}Payment Cancelled`, "The payment was cancelled by the user", 'info');
              // Stop loading and close
              setIsProcessingPayment?.(false);
              onClose?.();
              break;

            case "onramp_api.commit_error":
            case "onramp_api.load_error":
              console.log('Payment cancelled or error,', data.data);
              onAlert?.(`${sandboxPrefix}Payment Error`, `The payment failed: ${data.data.errorCode} - ${data.data.errorMessage}`, 'error');
              // Stop loading and close
              setIsProcessingPayment?.(false);
              onClose?.();
              break;

            case "onramp_api.commit_success":
              if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
                timeoutRef.current = null;
              }
              console.log('Payment successful! Now tracking transaction...');
              setTransactionStatus?.('pending');
              // Show immediate success for payment
              onAlert?.(`${sandboxPrefix}Payment Successful!`, "Your payment has been processed. We're now delivering your crypto to your wallet. You may stay to track the transaction or close this window and track history later", 'success');
              break;

            // Optional tracking or polling events (transaction on chain)
            case "onramp_api.polling_start":
              console.log('Started tracking blockchain transaction...');

              // Start a longer timeout for crypto delivery (5 minutes)
              timeoutRef.current = setTimeout(() => {
                console.log('Crypto delivery timeout - but payment was successful');
                onAlert?.(
                  "Delivery Taking Longer", 
                  "Your payment was successful, but crypto delivery is taking longer than expected. You can check your wallet or transaction history for updates.", 
                  'info'
                );
                // Don't close the widget - let polling continue in background
              }, 300000); // 5 minutes for blockchain delivery
              break;
            
            case "onramp_api.polling_success":
              console.log('Funds delivered to wallet!');
              setTransactionStatus?.('success');
              onAlert?.(`${sandboxPrefix}Complete!`, "Your crypto has been delivered to your wallet!", 'success');
              setTimeout(() => onClose?.(), 2000);
              break;

            case "onramp_api.polling_error":
              console.log('Transaction failed on blockchain', data.data);
              setTransactionStatus?.('error');
              onAlert?.(`${sandboxPrefix}Transaction Failed`, `There was an issue processing your transaction: ${data.data.errorCode} - ${data.data.errorMessage}`, 'error');
              setTimeout(() => onClose?.(), 2000);
              break;

            case "onramp_api.polling_success":
            case "onramp_api.polling_error":
            case "onramp_api.cancel":
            case "onramp_api.commit_error":
            case "onramp_api.load_error":
              // Clear timeout on final states
              if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
                timeoutRef.current = null;
              }
              break;
              
            default:
              console.log("Other event: " + eventName, data.data);
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
    />
  );
}