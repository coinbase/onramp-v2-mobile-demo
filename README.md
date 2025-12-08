# Coinbase Onramp V2 Demo App

A React Native + Expo mobile app demonstrating Coinbase's Onramp v2 API with CDP Embedded Wallets, Apple Pay integration, and real-time push notifications.

![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)

## Features

- 🔐 **Embedded Wallet**: Automatic wallet creation via CDP
- 💳 **Multiple Payment Methods**: Apple Pay and Coinbase Widget
- 🌐 **Multi-Network**: Base, Ethereum, Solana support
- 🔔 **Push Notifications**: Real-time transaction updates
- 💸 **Gasless Transfers**: Paymaster support on Base (USDC, EURC, cbBTC)
- 📜 **Transaction History**: Complete purchase tracking
- 🧪 **Sandbox Mode**: Test without real transactions

## Tech Stack

- React Native + Expo Router
- TypeScript
- Onramp V2 Apple Pay integration
- CDP React Native SDK
- Node.js/Express backend
- Expo Notifications

## Quick Start

### Prerequisites

- Node.js v20+
- iOS device or simulator
- [Coinbase CDP account](https://portal.cdp.coinbase.com/)

### 1. Installation

```bash
# Clone and install dependencies
git clone <your-repo-url>
cd onramp-v2-new
npm install
cd server && npm install && cd ..
```

### 2. Get Your CDP Credentials

1. Go to [CDP Portal](https://portal.cdp.coinbase.com/)
2. Create a new project (or use existing)
3. Copy your **Project ID**
4. Generate **API Keys** (you'll need the key name and private key in `Ed25519`)

### 3. Environment Setup

#### Root `.env`

```bash
# Copy template
cp .env.example .env
```

Edit `.env`:
```bash
# CDP Project ID from portal
EXPO_PUBLIC_CDP_PROJECT_ID=your_project_id_here

# Local server (will update with ngrok URL in step 5)
EXPO_PUBLIC_BASE_URL=http://localhost:3000

# Crypto implementation selector
# - Set to 'true' for Expo Go (npx expo start)
# - Set to 'false' for development builds (npx expo run:ios)
EXPO_PUBLIC_USE_EXPO_CRYPTO=true
```

#### Server `.env`

```bash
# Copy template
cp server/.env.example server/.env
```

Edit `server/.env`:
```bash
# CDP API Credentials from portal
CDP_API_KEY_ID=your_api_key_id
CDP_API_KEY_SECRET=your_private_key_here

# Optional: Webhook signing secret (for push notifications)
WEBHOOK_SECRET=your_webhook_secret

# Optional: APNs credentials (for production iOS push notifications)
# Leave empty to use Expo Push Service in development
APNS_KEY_ID=
APNS_TEAM_ID=
APNS_KEY=

# Optional: Database URL (for production deployment)
# Leave empty to use in-memory storage in development
# Supports Redis, MongoDB, or any compatible database
DATABASE_URL=
```

### 4. Start Development Servers

Open **two terminal windows**:

```bash
# Terminal 1: Start backend server
cd server
npm run dev
# Should see: "Server running on http://localhost:3000"
```

```bash
# Terminal 2: Start Expo

# Option A: Expo Go (requires USE_EXPO_CRYPTO=true in .env)
npx expo start
# Scan QR code with Expo Go app or press 'i' for iOS simulator

# Option B: Development build (set USE_EXPO_CRYPTO=false in .env)
npx expo run:ios
# Builds and installs native iOS app with full crypto support
```

### 5. Setup Webhooks for Push Notifications (Optional)

**Note**: Webhooks enable real-time push notifications for transaction updates. The app works fully without webhooks, but you won't receive push notifications.

**⚠️ Localhost Limitation**: Coinbase webhook servers cannot reach `localhost`. To enable webhooks, you need a publicly accessible URL.

**Options:**
- **Development**: Use a tunneling service (ngrok, localtunnel, etc.) to expose your local server
- **Production**: Deploy to a hosting platform (Vercel, Railway, Render, etc.)

**Setup steps:**

1. **Get a public URL** for your backend (e.g., `https://your-domain.com` or `https://abc123.ngrok.io`)

2. **Update `.env`**:
   ```bash
   EXPO_PUBLIC_BASE_URL=https://your-public-url
   ```

3. **Create webhook subscription**: Follow [CDP webhook documentation](https://docs.cdp.coinbase.com/onramp-&-offramp/webhooks#create-a-webhook-subscription) using your webhook URL: `https://your-public-url/webhooks/onramp`

4. **Restart Expo** (press `r` in terminal)

**Testing on physical device without webhooks:**
```bash
# Get your local network IP
ipconfig getifaddr en0
# Update .env: EXPO_PUBLIC_BASE_URL=http://192.168.1.100:3000
```

**⚠️ iOS Simulator**: Push notifications do NOT work on iOS Simulator. Use a physical device for testing.

### 6. Run the App

1. Open **Expo Go** app on your iOS device or iOS Simulator
2. Scan the QR code from Terminal 2
3. App will load on your device or simulator

**Push notifications work automatically** via Expo Push Service - no additional setup needed!

## Using the App

### First Time Setup

1. **Sign In**: Enter your email → Verify code
2. **Wallet Created**: Embedded wallet auto-created
3. **Complete Profile**:
   - Verify phone (optional for testing)
   - Select region
   - Select Sandbox / Production mode for Onramp transaction

### Making a Purchase

1. **Home Tab**: Fill out onramp form
   - Select network (Base, Ethereum, Solana)
   - Select asset (USDC, ETH, SOL, etc.)
   - Enter amount
2. **Choose Payment**:
   - **Apple Pay**: Native iOS payment
   - **Coinbase Widget**: Opens widget on default browser
3. **Complete Purchase**
4. **Receive Notification**: Transaction status notification on Production

### Sandbox Mode

Test without real transactions:

1. Go to **Profile Tab**
2. Toggle **Sandbox Mode** ON
3. Features enabled:
   - Optional phone verification
   - Any wallet address override accepted
   - No real blockchain transactions
   - Email verification still required for server authentication

> **Note**: Sandbox mode auto-resets on app restart for safety.

## Project Structure

```
/app/                 # Expo Router pages
  ├─ (tabs)/          # Bottom tab navigation
  │   ├─ index.tsx    # Home: Onramp form
  │   ├─ profile.tsx  # Settings & wallet
  │   └─ history.tsx  # Transaction history
  ├─ auth/            # Email/phone verification
  └─ transfer.tsx     # Token transfer

/components/          # React components
  ├─ onramp/          # Onramp-specific UI
  └─ ui/              # Reusable UI components

/hooks/               # Custom hooks
  └─ useOnramp.ts     # Onramp logic & API calls

/utils/               # Helper functions
  ├─ sharedState.ts   # Global state
  ├─ create*.ts       # Onramp v2 API
  └─ fetch*.ts        # Onramp v1 API

/server/              # Backend proxy
  └─ src/app.ts       # Express server
```

## Key Concepts

### Smart Account vs EOA

The app creates two wallet types:
- **EOA**: Standard wallet (externally owned account)
- **Smart Account**: ERC-4337 account abstraction

**Important**: The app displays **Smart Account balances** only. All EVM onramp funds automatically go to the Smart Account.

### Backend Proxy Pattern

For security, API keys are **never exposed** to the client:

```
Client App → Backend Proxy → Coinbase API
              (has API keys)
```

This prevents API key theft if someone inspects your app.

### Gasless Transfers

On Base network, transfers of USDC, EURC, or BTC are **gasless** (no ETH needed for gas) thanks to Coinbase Paymaster.

## Troubleshooting

### "Wallet not creating"
- Verify `EXPO_PUBLIC_CDP_PROJECT_ID` is correct
- Check CDP Portal for project status

### "Push notifications not working"
- **iOS Simulator**: Push notifications do not work on iOS Simulator. Use a physical device.
- Should work automatically in Expo Go on physical devices (uses Expo Push Service)
- For webhooks, verify your backend has a public URL (localhost won't work)
- Check `.env` has correct `EXPO_PUBLIC_BASE_URL`
- Verify webhook subscription is created in CDP Portal
- Restart Expo after updating `.env`

### "Transaction failing"
- Enable **Sandbox Mode** for testing
- Verify phone verification is complete (for Apple Pay)
- Check backend logs: `cd server && npm run dev`

## Development Tips

### Testing Without Real Money

1. Enable **Sandbox Mode** in Profile tab
2. All transactions will be simulated
3. No real blockchain interaction

### Viewing Backend Logs

```bash
cd server
npm run dev
# Watch console for API requests/responses
```

### Debugging Push Notifications

Check Expo logs:
```bash
# In Expo terminal (Terminal 2)
# Look for lines with [PUSH] prefix
```

### Resetting App State

1. Sign out from Profile tab
2. Force close app
3. Relaunch

## Environment Variables

### Required (Root `.env`)

| Variable | Description |
|----------|-------------|
| `EXPO_PUBLIC_CDP_PROJECT_ID` | Your CDP project ID |
| `EXPO_PUBLIC_BASE_URL` | Backend server URL (public URL for webhooks, or `http://localhost:3000` for local testing) |
| `EXPO_PUBLIC_USE_EXPO_CRYPTO` | `true` for Expo Go (`npx expo start`), `false` for dev builds (`npx expo run:ios`) |

### Required (Server `.env`)

| Variable | Description |
|----------|-------------|
| `CDP_API_KEY_ID` | CDP API key ID |
| `CDP_API_KEY_SECRET` | CDP API private key |

### Optional (Server `.env`)

| Variable | Description |
|----------|-------------|
| `WEBHOOK_SECRET` | Webhook signing secret from CDP Portal (required for push notifications) |
| `APNS_KEY_ID` | Apple Push Notification service key ID (for production iOS notifications) |
| `APNS_TEAM_ID` | Apple Developer Team ID |
| `APNS_KEY` | APNs private key (.p8 file content) |
| `DATABASE_URL` | Database URL for production deployment (supports Redis, MongoDB, etc. - uses in-memory storage if not set) |

## Documentation

- [CDP Documentation](https://docs.cdp.coinbase.com/)
- [Onramp API](https://docs.cdp.coinbase.com/onramp-&-offramp/introduction/quickstart)
- [CDP React Native SDK](https://docs.cdp.coinbase.com/embedded-wallets/react-native/quickstart)
- [Expo Documentation](https://docs.expo.dev/)

## License

This project is licensed under the Apache License 2.0 - see the [LICENSE](LICENSE) file for details.
