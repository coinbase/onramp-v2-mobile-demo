# Coinbase Apple Pay iOS Demo

Minimal working implementation of Coinbase Apple Pay Onramp for native iOS apps using WKWebView.

## Video Demo


https://github.com/user-attachments/assets/ee734f06-3292-4874-8113-b8a360370b6e



## Project Structure

```
iOS/                        # Native iOS Swift app
├── ViewController.swift    # Main: WKWebView + postMessage bridge
├── AppDelegate.swift
├── SceneDelegate.swift
├── Info.plist             # Network security config
└── project.yml            # XcodeGen config

web/                       # Backend + Web interface
├── server.js              # Express API
├── public/
│   ├── index.html
│   └── app.js
└── .env.example           # API credentials template
```

## Quick Start

### 1. Backend Setup

```bash
cd web
npm install
cp .env.example .env
```

Edit `.env` and add your Coinbase CDP API credentials:
```
CDP_API_KEY_ID=your_api_key_id
CDP_API_KEY_SECRET=your_api_key_secret
```

Start server:
```bash
npm start
```

**Web Testing:** Open `http://localhost:3000` in your browser to test the Apple Pay flow using the iframe method (displays QR code fallback for web).

### 2. iOS App Setup

**Option A: Same WiFi Network**

1. Find your computer's IP address:
   ```bash
   ifconfig | grep "inet " | grep -v 127.0.0.1
   ```

2. Update `ViewController.swift` line 153:
   ```swift
   let backendURL = "http://YOUR_IP_ADDRESS:3000/api/create-order"
   ```

**Option B: Using ngrok (Recommended)**

```bash
# Install ngrok
brew install ngrok

# Create tunnel
ngrok http 3000
```

Update `ViewController.swift` line 153 with the ngrok URL:
```swift
let backendURL = "https://your-ngrok-url.ngrok-free.dev/api/create-order"
```

### 3. Run iOS App

1. Open `iOS/` directory in Xcode
2. Connect iPhone via USB
3. Select your device in Xcode
4. Build & Run (⌘R)

**Note:** Apple Pay requires a physical iOS device with Apple Pay support and setup It will not work in the simulator.

## Requirements

- macOS with Xcode 14+
- Node.js 16+
- iOS 14.0+ device with Apple Pay configured
- [Coinbase CDP API credentials](https://portal.cdp.coinbase.com)

## Key Implementation Details

### WKWebView Configuration

```swift
let configuration = WKWebViewConfiguration()
configuration.allowsInlineMediaPlayback = true
configuration.mediaTypesRequiringUserActionForPlayback = []

let contentController = WKUserContentController()
contentController.add(self, name: "onramp")
configuration.userContentController = contentController
```

### Coinbase Event Handling

The app listens for these events via `WKScriptMessageHandler`:

- See all events [here](https://docs.cdp.coinbase.com/onramp-&-offramp/onramp-apis/apple-pay-onramp-api#post-message-events)

See `ViewController.swift` lines 357-410 for full implementation.

## Sandbox Testing

The demo uses sandbox mode by default. Transactions use test credentials and won't charge real money.

## Troubleshooting

**"Internet connection appears to be offline"**
- Ensure iPhone and computer are on the same WiFi
- Check firewall settings
- Use ngrok to bypass network issues

**Apple Pay not appearing**
- Must use physical iOS device (not simulator)
- Device must have Apple Pay configured
- App must be served over HTTPS (use ngrok for testing)

**Events not being received**
- Check message handler name is `"onramp"`
- Verify JavaScript bridge injection in `didFinish` navigation
- Enable Safari Web Inspector to debug

## Documentation

- [Coinbase Onramp Documentation](https://docs.cdp.coinbase.com/onramp/docs)
- [Apple Pay Onramp API](https://docs.cdp.coinbase.com/onramp-&-offramp/onramp-apis/apple-pay-onramp-api)

## License

MIT
