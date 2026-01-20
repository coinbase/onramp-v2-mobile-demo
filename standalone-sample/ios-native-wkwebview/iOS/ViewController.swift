import UIKit
import WebKit

class ViewController: UIViewController {

    // MARK: - Properties

    private var webView: WKWebView!
    private var activityIndicator: UIActivityIndicatorView!
    private var eventLogTextView: UITextView!
    private var payButton: UIButton!

    // Event log
    private var events: [String] = []

    // MARK: - Lifecycle

    override func viewDidLoad() {
        super.viewDidLoad()

        title = "Coinbase Apple Pay Demo"
        view.backgroundColor = .systemBackground

        setupUI()
        setupWebView()
    }

    // MARK: - UI Setup

    private func setupUI() {
        // Pay Button
        payButton = UIButton(type: .system)
        payButton.setTitle("Buy Crypto with Apple Pay", for: .normal)
        payButton.titleLabel?.font = .systemFont(ofSize: 18, weight: .semibold)
        payButton.backgroundColor = .systemBlue
        payButton.setTitleColor(.white, for: .normal)
        payButton.layer.cornerRadius = 8
        payButton.addTarget(self, action: #selector(startPayment), for: .touchUpInside)
        payButton.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(payButton)

        // Activity Indicator
        activityIndicator = UIActivityIndicatorView(style: .large)
        activityIndicator.hidesWhenStopped = true
        activityIndicator.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(activityIndicator)

        // Event Log Title
        let logLabel = UILabel()
        logLabel.text = "Event Log:"
        logLabel.font = .systemFont(ofSize: 16, weight: .semibold)
        logLabel.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(logLabel)

        // Event Log TextView
        eventLogTextView = UITextView()
        eventLogTextView.font = .monospacedSystemFont(ofSize: 12, weight: .regular)
        eventLogTextView.backgroundColor = .systemGray6
        eventLogTextView.layer.cornerRadius = 8
        eventLogTextView.layer.borderWidth = 1
        eventLogTextView.layer.borderColor = UIColor.systemGray4.cgColor
        eventLogTextView.isEditable = false
        eventLogTextView.text = "Events will appear here...\n"
        eventLogTextView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(eventLogTextView)

        // Layout Constraints
        NSLayoutConstraint.activate([
            payButton.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 20),
            payButton.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 20),
            payButton.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -20),
            payButton.heightAnchor.constraint(equalToConstant: 50),

            activityIndicator.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            activityIndicator.centerYAnchor.constraint(equalTo: view.centerYAnchor),

            logLabel.topAnchor.constraint(equalTo: payButton.bottomAnchor, constant: 20),
            logLabel.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 20),

            eventLogTextView.topAnchor.constraint(equalTo: logLabel.bottomAnchor, constant: 8),
            eventLogTextView.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 20),
            eventLogTextView.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -20),
            eventLogTextView.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -20)
        ])
    }

    private func setupWebView() {
        // Configure WKWebView for Coinbase Apple Pay
        let configuration = WKWebViewConfiguration()
        configuration.preferences.javaScriptEnabled = true

        // IMPORTANT: Set up message handler for postMessage events
        let contentController = WKUserContentController()
        contentController.add(self, name: "onramp")
        configuration.userContentController = contentController

        // CRITICAL: These settings are required for Apple Pay to work
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []

        // Create hidden webview (will only show Apple Pay sheet, not the web page)
        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.isHidden = true // Hidden - we only want the Apple Pay sheet
        view.addSubview(webView)
    }

    // MARK: - Payment Flow

    @objc private func startPayment() {
        logEvent("Initiating payment flow...")

        payButton.isEnabled = false
        activityIndicator.startAnimating()

        // Call backend API to get payment link
        getPaymentLink { [weak self] result in
            DispatchQueue.main.async {
                self?.activityIndicator.stopAnimating()

                switch result {
                case .success(let paymentURL):
                    self?.logEvent("✅ Got payment link: \(paymentURL)")
                    self?.loadPaymentURL(paymentURL)

                case .failure(let error):
                    self?.logEvent("❌ Error: \(error.localizedDescription)")
                    self?.payButton.isEnabled = true
                    self?.showAlert(title: "Error", message: error.localizedDescription)
                }
            }
        }
    }

    private func loadPaymentURL(_ urlString: String) {
        guard let url = URL(string: urlString) else {
            logEvent("❌ Invalid URL")
            payButton.isEnabled = true
            return
        }

        logEvent("Loading payment URL in WKWebView...")
        let request = URLRequest(url: url)
        webView.load(request)
    }

    private func getPaymentLink(completion: @escaping (Result<String, Error>) -> Void) {
        // In a real app, you would call your backend server here
        // For this demo, we'll use a mock URL that you'll need to replace

        // REPLACE THIS with your actual backend endpoint that returns the payment link
        let backendURL = "https://YOUR-NGROK-URL.ngrok-free.dev/api/create-order"

        guard let url = URL(string: backendURL) else {
            completion(.failure(NSError(domain: "Invalid backend URL", code: -1, userInfo: nil)))
            return
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        // Sandbox transaction - partnerUserRef must start with "sandbox-"
        let orderData: [String: Any] = [
            "paymentAmount": "20",
            "paymentCurrency": "USD",
            "purchaseCurrency": "USDC",
            "paymentMethod": "GUEST_CHECKOUT_APPLE_PAY",
            "destinationNetwork": "base",
            "destinationAddress": "0x88cF83FD9C2709cDcBe393C0862070887E29E6DE",
            "email": "reviewer@coinbase-demo.app",
            "phoneNumber": "+12345678901",
            "phoneNumberVerifiedAt": ISO8601DateFormatter().string(from: Date()),
            "partnerUserRef": "sandbox-ios-user-\(UUID().uuidString)", // IMPORTANT: sandbox- prefix
            "agreementAcceptedAt": ISO8601DateFormatter().string(from: Date()),
            "isQuote": false
        ]

        request.httpBody = try? JSONSerialization.data(withJSONObject: orderData)

        URLSession.shared.dataTask(with: request) { data, response, error in
            if let error = error {
                completion(.failure(error))
                return
            }

            guard let data = data else {
                completion(.failure(NSError(domain: "No data received", code: -1, userInfo: nil)))
                return
            }

            do {
                if let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                   let paymentLink = json["paymentLink"] as? String {
                    completion(.success(paymentLink))
                } else {
                    completion(.failure(NSError(domain: "Invalid response format", code: -1, userInfo: nil)))
                }
            } catch {
                completion(.failure(error))
            }
        }.resume()
    }

    // MARK: - Helper Methods

    private func logEvent(_ message: String) {
        let timestamp = DateFormatter.localizedString(from: Date(), dateStyle: .none, timeStyle: .medium)
        let logEntry = "[\(timestamp)] \(message)\n"

        events.append(logEntry)
        eventLogTextView.text += logEntry

        // Auto-scroll to bottom
        let bottom = NSMakeRange(eventLogTextView.text.count - 1, 1)
        eventLogTextView.scrollRangeToVisible(bottom)

        print(logEntry)
    }

    private func showAlert(title: String, message: String) {
        let alert = UIAlertController(title: title, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default))
        present(alert, animated: true)
    }

    private func handleCoinbaseEvent(_ eventName: String, data: [String: Any]?) {
        logEvent("🔔 Event: \(eventName)")

        if let data = data {
            logEvent("   Data: \(data)")
        }

        switch eventName {
        case "onramp_api.load_pending":
            logEvent("⏳ Loading Apple Pay button...")

        case "onramp_api.load_success":
            logEvent("✅ Apple Pay button loaded successfully")
            // Auto-click the Apple Pay button
            autoClickApplePayButton()

        case "onramp_api.load_error":
            logEvent("❌ Failed to load Apple Pay button")
            payButton.isEnabled = true
            showAlert(title: "Load Error", message: "Failed to load payment interface")

        case "onramp_api.commit_success":
            logEvent("✅ Payment authorized! Processing transaction...")
            showAlert(title: "Payment Successful", message: "Your payment has been authorized. Transaction is processing...")

        case "onramp_api.polling_start":
            logEvent("🔄 Tracking blockchain transaction...")

        case "onramp_api.polling_success":
            logEvent("🎉 Transaction complete! Crypto delivered to wallet.")
            payButton.isEnabled = true
            showAlert(title: "Success!", message: "Crypto has been delivered to your wallet!")

        case "onramp_api.polling_error":
            logEvent("❌ Transaction failed on blockchain")
            payButton.isEnabled = true
            showAlert(title: "Transaction Failed", message: "The blockchain transaction encountered an error")

        case "onramp_api.commit_error":
            logEvent("❌ Payment authorization failed")
            payButton.isEnabled = true
            showAlert(title: "Payment Failed", message: "Payment authorization was not successful")

        case "onramp_api.cancel":
            logEvent("ℹ️ User cancelled payment")
            payButton.isEnabled = true
            showAlert(title: "Cancelled", message: "Payment was cancelled")

        default:
            logEvent("ℹ️ Unknown event: \(eventName)")
        }
    }

    private func autoClickApplePayButton() {
        logEvent("🖱️ Auto-clicking Apple Pay button...")

        // Inject JavaScript to hide the button and trigger click
        let script = """
        (function() {
            // Hide the Apple Pay button (we only want the native sheet)
            const style = document.createElement('style');
            style.textContent = `
                apple-pay-button {
                    display: none !important;
                }
                body {
                    background: transparent !important;
                }
            `;
            document.head.appendChild(style);

            // Auto-click the button to trigger Apple Pay
            const btn = document.getElementById('api-onramp-apple-pay-button');
            if (btn) {
                btn.click();
                return 'clicked';
            }
            return 'not found';
        })();
        """

        webView.evaluateJavaScript(script) { [weak self] result, error in
            if let error = error {
                self?.logEvent("❌ Failed to click button: \(error.localizedDescription)")
            } else if let result = result as? String {
                self?.logEvent("🖱️ Button click result: \(result)")
            }
        }
    }
}

// MARK: - WKScriptMessageHandler

extension ViewController: WKScriptMessageHandler {
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        // This is the CRITICAL bridge for receiving postMessage events from the Coinbase web page

        guard message.name == "onramp" else { return }

        // Parse the message body
        if let messageBody = message.body as? String {
            // Try parsing as JSON string
            if let data = messageBody.data(using: .utf8),
               let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                handleMessageData(json)
            }
        } else if let messageBody = message.body as? [String: Any] {
            // Already a dictionary
            handleMessageData(messageBody)
        }
    }

    private func handleMessageData(_ data: [String: Any]) {
        guard let eventName = data["eventName"] as? String else { return }
        handleCoinbaseEvent(eventName, data: data)
    }
}

// MARK: - WKNavigationDelegate

extension ViewController: WKNavigationDelegate {
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        logEvent("📄 WebView page loaded")

        // Inject script to bridge postMessage to WKWebView
        let bridgeScript = """
        (function() {
            // Override window.postMessage to send to native iOS
            const originalPostMessage = window.postMessage;
            window.postMessage = function(message, targetOrigin) {
                // Send to native
                if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.onramp) {
                    window.webkit.messageHandlers.onramp.postMessage(message);
                }
                // Also call original
                originalPostMessage.apply(window, arguments);
            };

            // Listen for postMessage from iframe
            window.addEventListener('message', function(event) {
                // Validate origin is from Coinbase
                try {
                    const originUrl = new URL(event.origin);
                    const allowedHosts = ['pay.coinbase.com', 'coinbase.com'];
                    const isAllowed = allowedHosts.some(host =>
                        originUrl.hostname === host || originUrl.hostname.endsWith('.' + host)
                    );
                    if (!isAllowed) return;
                } catch (e) {
                    return;
                }

                const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
                if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.onramp) {
                    window.webkit.messageHandlers.onramp.postMessage(data);
                }
            });
        })();
        """

        webView.evaluateJavaScript(bridgeScript) { [weak self] _, error in
            if let error = error {
                self?.logEvent("❌ Failed to inject bridge: \(error.localizedDescription)")
            } else {
                self?.logEvent("✅ postMessage bridge injected")
            }
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        logEvent("❌ WebView failed to load: \(error.localizedDescription)")
        payButton.isEnabled = true
    }
}

// MARK: - WKUIDelegate

extension ViewController: WKUIDelegate {
    // This is important for handling alerts and prompts from the web page
}
