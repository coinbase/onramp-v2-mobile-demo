# Coinbase Apple Pay iOS Demo

Minimal working example of Coinbase Apple Pay integration for native iOS apps using WKWebView.

## Video Demo

https://github.com/user-attachments/assets/ee734f06-3292-4874-8113-b8a360370b6e

## Project Structure

```
iOS/                        # Native iOS Swift app
├── ViewController.swift    # WKWebView implementation
├── AppDelegate.swift
├── SceneDelegate.swift
├── Info.plist             # Network security config
└── project.yml            # XcodeGen config

web/                       # Backend server + Web testing
├── server.js              # Express API to create payment orders
├── public/
│   ├── index.html        # Web testing interface
│   └── app.js
└── .env.example          # API credentials template
```

## Quick Start

### 1. Backend Setup

```bash
cd web
npm install
cp .env.example .env
```

Edit `.env` and add your [Coinbase CDP API credentials](https://portal.cdp.coinbase.com):
```
CDP_API_KEY_ID=your_api_key_id
CDP_API_KEY_SECRET=your_api_key_secret
```

Start server:
```bash
npm start
```

**Optional:** Test in browser at `http://localhost:3000` (shows QR code for web)

### 2. iOS App Setup

**Option A: Same WiFi Network**

Find your computer's IP address:
```bash
ifconfig | grep "inet " | grep -v 127.0.0.1
```

Update `ViewController.swift` line 153:
```swift
let backendURL = "http://YOUR_IP_ADDRESS:3000/api/create-order"
```

**Option B: Using ngrok (Recommended)**

```bash
brew install ngrok
ngrok http 3000
```

Update `ViewController.swift` line 153:
```swift
let backendURL = "https://your-ngrok-url.ngrok-free.dev/api/create-order"
```

### 3. Run iOS App

1. Open `iOS/` directory in Xcode
2. Connect iPhone via USB
3. Select your device in Xcode
4. Build & Run (⌘R)

**Note:** Requires a physical iOS device with Apple Pay configured. Won't work in simulator.

## Requirements

- macOS with Xcode 14+
- Node.js 16+
- Physical iOS device (iOS 14.0+) with Apple Pay set up
- [Coinbase CDP API credentials](https://portal.cdp.coinbase.com)

## How It Works

### 1. Create Payment Order

Your backend calls the Coinbase API to create an order and receive a payment URL:

```javascript
// Backend calls Coinbase
const response = await fetch('https://api.cdp.coinbase.com/platform/v2/onramp/orders', {
    method: 'POST',
    body: JSON.stringify({
        paymentAmount: "20",
        paymentCurrency: "USD",
        purchaseCurrency: "USDC",
        paymentMethod: "GUEST_CHECKOUT_APPLE_PAY",
        // ... other fields
    })
});

// Returns: { paymentLink: { url: "https://pay.coinbase.com/..." } }
```

### 2. Configure WKWebView

Set up WKWebView with the message handler:

```swift
// Configure WKWebView
let configuration = WKWebViewConfiguration()

// Register message handler to receive payment events
let contentController = WKUserContentController()
contentController.add(self, name: "cbOnramp")  // Must be "cbOnramp"
configuration.userContentController = contentController

// Create WKWebView
webView = WKWebView(frame: .zero, configuration: configuration)
```

### 3. Load Payment URL

```swift
// Load the payment URL from Coinbase
let url = URL(string: paymentLink)
webView.load(URLRequest(url: url))
```

### 4. Receive Payment Events

Coinbase detects `window.webkit.messageHandlers.cbOnramp` and sends events directly:

```swift
extension ViewController: WKScriptMessageHandler {
    func userContentController(_ userContentController: WKUserContentController,
                              didReceive message: WKScriptMessage) {
        guard message.name == "cbOnramp" else { return }

        // Parse event
        if let messageBody = message.body as? String,
           let data = messageBody.data(using: .utf8),
           let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let eventName = json["eventName"] as? String {
            print("Payment event: \(eventName)")
            handlePaymentEvent(eventName, data: json)
        }
    }
}
```

## Payment Events

The payment flow sends various events like `onramp_api.load_success`, `onramp_api.commit_success`, `onramp_api.polling_success`, etc.

See the [full list of events](https://docs.cdp.coinbase.com/onramp-&-offramp/onramp-apis/apple-pay-onramp-api#post-message-events) in the Coinbase documentation.

## Sandbox Testing

The demo uses sandbox mode (no real money):
- `partnerUserRef` must start with `"sandbox-"`
- Transactions auto-complete

## Troubleshooting

**"Internet connection appears to be offline"**
- Ensure iPhone and Mac are on same WiFi
- Try ngrok instead of local IP
- Check firewall settings

**Apple Pay sheet doesn't appear**
- Must use physical device (not simulator)
- Device must have Apple Pay configured
- Ensure message handler name is exactly `"cbOnramp"`

**No events received**
- Handler name must be exactly `"cbOnramp"` (case-sensitive)
- Check Safari Web Inspector for JavaScript errors

## Documentation

- [Coinbase Onramp API Docs](https://docs.cdp.coinbase.com/onramp/docs)
- [Apple Pay Onramp API](https://docs.cdp.coinbase.com/onramp-&-offramp/onramp-apis/apple-pay-onramp-api)
- [CDP Portal (API Keys)](https://portal.cdp.coinbase.com)

## License

MIT
