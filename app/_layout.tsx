import { CDPHooksProvider, Config } from "@coinbase/cdp-hooks";
import { Stack } from "expo-router";
import { COLORS } from "../constants/Colors";

import { AuthGate } from "@/components/AuthGate";
import { AuthInitializer } from "@/components/AuthInitializer";
import { getTestWalletEvm, getTestWalletSol, hydrateSandboxMode, hydrateTestSession, hydrateVerifiedPhone, isTestSessionActive, setCurrentSolanaAddress, setCurrentWalletAddress } from "@/utils/sharedState";
import { useEffect } from "react";
import 'react-native-get-random-values';
import 'react-native-url-polyfill/auto';

// Import polyfills (only used conditionally)

const { BLUE, TEXT_SECONDARY, CARD_BG, BORDER, TEXT_PRIMARY } = COLORS;

// Conditional crypto setup based on build type
const isExpoGo = process.env.EXPO_PUBLIC_USE_EXPO_CRYPTO === 'true';

// CDP configuration with both ETH and SOL support
const cdpConfig: Config = {
  projectId: process.env.EXPO_PUBLIC_CDP_PROJECT_ID!,
  basePath: "https://api.cdp.coinbase.com/platform",
  ethereum: {
    createOnLogin: "smart"
  },
  solana: {
    createOnLogin: true
  },
  useMock: false
};
console.log('RootLayout mounted, CDP config:', cdpConfig);

export default function RootLayout() {
  useEffect(() => {
    // Hydrate sandbox mode preference
    hydrateSandboxMode().catch(() => {});

    // Hydrate phone verification
    hydrateVerifiedPhone().catch(() => {});

    // Hydrate test session (TestFlight)
    hydrateTestSession().then(() => {
      if (isTestSessionActive()) {
        console.log('🧪 Test session restored from storage');
        setCurrentWalletAddress(getTestWalletEvm());
        setCurrentSolanaAddress(getTestWalletSol());
        // Note: NOT forcing sandbox - let reviewer choose mode via Profile
      }
    }).catch(() => {});
  }, []);

  return (
    <CDPHooksProvider config={cdpConfig}>
      <AuthInitializer>
        <AuthGate>
          <Stack screenOptions={{ headerShown: false }}>
            {/* Auth screens */}
            <Stack.Screen
              name="auth/login"
              options={{
                headerShown: false,
                gestureEnabled: false,  // Can't swipe back from login
                animation: 'fade',
              }}
            />

            {/* Phone verification pages - no tabs */}
            <Stack.Screen
              name="phone-verify"
              options={{
                presentation: 'card',
                animation: 'slide_from_right',
              }}
            />
            <Stack.Screen
                name="phone-code"
                options={{
                  presentation: 'card',
                  animation: 'slide_from_right',
                }}
            />

            {/* Main app with tabs */}
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          </Stack>
        </AuthGate>
      </AuthInitializer>
    </CDPHooksProvider>
  );
}