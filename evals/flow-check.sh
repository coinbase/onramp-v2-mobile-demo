#!/bin/bash
# =============================================================================
# flow-check.sh — Feature wiring & implementation completeness checks
#
# Usage: bash evals/flow-check.sh
# Run from the project root. Exits 0 if all pass, 1 if any fail.
# =============================================================================

PASS=0
FAIL=0
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TABS="$ROOT/app/(tabs)"
INDEX="$TABS/index.tsx"
PROFILE="$TABS/profile.tsx"
SERVER="$ROOT/server"
HOOKS="$ROOT/hooks"
UTILS="$ROOT/utils"
APP="$ROOT/app"
COMPONENTS="$ROOT/components"
CONSTANTS="$ROOT/constants"

pass() { echo "✅  $1"; ((PASS++)); }
fail() { echo "❌  $1"; ((FAIL++)); }

check_true()  { local desc=$1; shift; if "$@" > /dev/null 2>&1; then pass "$desc"; else fail "$desc"; fi; }
check_false() { local desc=$1; shift; if "$@" > /dev/null 2>&1; then fail "$desc"; else pass "$desc"; fi; }

echo ""
echo "🔐  Auth & Wallet"
echo "────────────────────────────────────────"

check_true "AuthGate wraps tab navigation" \
  grep -q "AuthGate" "$ROOT/app/_layout.tsx"

check_true "CDPHooksProvider wraps app" \
  grep -q "CDPHooksProvider" "$ROOT/app/_layout.tsx"

check_true "Sandbox mode resets to true on sign out" \
  grep -q "setSandboxMode(true)" "$PROFILE"

check_true "getAccessTokenGlobal util exists" \
  test -f "$UTILS/getAccessTokenGlobal.ts"

check_true "authenticatedFetch wraps API calls" \
  test -f "$UTILS/authenticatedFetch.ts"

echo ""
echo "📱  Onramp Widget Flow"
echo "────────────────────────────────────────"

check_true "createOnrampSession util exists" \
  test -f "$UTILS/createOnrampSession.ts"

check_true "useOnramp hook exists" \
  test -f "$HOOKS/useOnramp.ts"

check_true "Session payload includes redirectUrl deep link" \
  grep -q "redirectUrl.*onrampdemo://" "$HOOKS/useOnramp.ts"

check_true "Widget opens via in-app browser (not external Safari)" \
  grep -q "openAuthSessionAsync" "$INDEX"

check_true "onramp-return screen handles redirect params" \
  grep -q "useLocalSearchParams" "$APP/onramp-return.tsx"

check_true "Sandbox URL substitution applied (pay-sandbox.coinbase.com)" \
  grep -q "pay-sandbox.coinbase.com" "$HOOKS/useOnramp.ts"

echo ""
echo "🍎  Apple Pay Flow"
echo "────────────────────────────────────────"

check_true "createGuestCheckoutOrder util exists" \
  test -f "$UTILS/createGuestCheckoutOrder.ts"

check_true "Phone verification required before Apple Pay" \
  grep -qE "isPhoneFresh60d|phoneFresh" "$INDEX"

check_true "Apple Pay guest checkout widget component exists" \
  find "$COMPONENTS" -name "*GuestCheckout*" | grep -q "."

echo ""
echo "💸  Offramp Flow"
echo "────────────────────────────────────────"

check_true "createOfframpSession util exists" \
  test -f "$UTILS/createOfframpSession.ts"

check_true "Offramp session includes redirectUrl deep link" \
  grep -q "onrampdemo://offramp-send" "$UTILS/createOfframpSession.ts"

check_true "offramp-send screen fetches transaction after redirect" \
  grep -q "fetchOfframpTransaction" "$APP/offramp-send.tsx"

check_true "Offramp on-chain send uses CDP hooks" \
  grep -qE "useSendUserOperation|useSendSolanaTransaction" "$APP/offramp-send.tsx"

check_true "TestFlight demo mode skips real transactions in offramp" \
  grep -q "isTestSessionActive" "$APP/offramp-send.tsx"

echo ""
echo "📊  Transaction History"
echo "────────────────────────────────────────"

check_true "fetchTransactionHistory util exists" \
  test -f "$UTILS/fetchTransactionHistory.ts"

check_true "History tab exists" \
  test -f "$TABS/history.tsx"

echo ""
echo "🧪  Sandbox & Test Safety"
echo "────────────────────────────────────────"

check_true "isTestSessionActive guard in transfer screen" \
  grep -q "isTestSessionActive" "$APP/transfer.tsx"

check_true "sharedState has sandbox mode getter/setter" \
  grep -qE "getSandboxMode|setSandboxMode" "$UTILS/sharedState.ts"

check_true "TestFlight accounts defined in constants" \
  test -f "$CONSTANTS/TestAccounts.ts"

echo ""
echo "🔔  Push Notifications"
echo "────────────────────────────────────────"

check_true "Push token registration util exists" \
  test -f "$UTILS/pushNotifications.ts"

check_true "Webhook server route handles onramp events" \
  grep -rql "onramp.transaction" --include="*.ts" --include="*.js" "$SERVER"

echo ""
echo "────────────────────────────────────────"
echo "  $PASS passed · $FAIL failed"
echo "────────────────────────────────────────"
echo ""

[ $FAIL -eq 0 ] || exit 1
