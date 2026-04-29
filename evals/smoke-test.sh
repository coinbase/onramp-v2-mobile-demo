#!/bin/bash
# =============================================================================
# smoke-test.sh — Security & build compliance checks
#
# Usage: bash evals/smoke-test.sh
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

pass() { echo "✅  $1"; ((PASS++)); }
fail() { echo "❌  $1"; ((FAIL++)); }

check_true()  { local desc=$1; shift; if "$@" > /dev/null 2>&1; then pass "$desc"; else fail "$desc"; fi; }
check_false() { local desc=$1; shift; if "$@" > /dev/null 2>&1; then fail "$desc"; else pass "$desc"; fi; }

echo ""
echo "🔐  Security"
echo "────────────────────────────────────────"

# Only flag actual hardcoded values (key=value pattern), not process.env references
check_false "No hardcoded CDP_API_KEY_SECRET value in source files" \
  grep -rn --include="*.ts" --include="*.tsx" \
    --exclude-dir=node_modules --exclude-dir=evals --exclude-dir=standalone-sample \
    -E "CDP_API_KEY_SECRET\s*=\s*[\"'][^\"']" "$ROOT"

check_false "No hardcoded WEBHOOK_SECRET value in source files" \
  grep -rn --include="*.ts" --include="*.tsx" \
    --exclude-dir=node_modules --exclude-dir=evals \
    -E "WEBHOOK_SECRET\s*=\s*[\"'][^\"']" "$ROOT"

check_true "Webhook signature verification exists in server" \
  grep -rql "verifyWebhookSignature\|createHmac" --include="*.ts" --include="*.js" "$SERVER"

echo ""
echo "🌐  Browser / Widget"
echo "────────────────────────────────────────"

check_true "openAuthSessionAsync used for Coinbase Widget" \
  grep -q "openAuthSessionAsync" "$INDEX"

check_true "expo-web-browser imported in index.tsx" \
  grep -q "expo-web-browser" "$INDEX"

check_false "No bare Linking.openURL for widget flow in index.tsx" \
  grep -v "//.*Linking\.openURL" "$INDEX" | grep -q "Linking\.openURL"

check_true "redirectUrl set in onramp session payload" \
  grep -q "redirectUrl" "$HOOKS/useOnramp.ts"

check_true "onramp-return.tsx landing screen exists" \
  test -f "$APP/onramp-return.tsx"

echo ""
echo "💸  Offramp"
echo "────────────────────────────────────────"

check_true "openAuthSessionAsync used in offramp flow (profile)" \
  grep -q "openAuthSessionAsync" "$PROFILE"

check_true "partnerUserRef extracted from offramp redirect" \
  grep -q "partnerUserRef" "$PROFILE"

check_true "setPendingOfframpBalance called before opening browser" \
  grep -q "setPendingOfframpBalance" "$PROFILE"

check_true "offramp-send.tsx exists" \
  test -f "$APP/offramp-send.tsx"

check_true "fetchOfframpTransaction util exists" \
  test -f "$UTILS/fetchOfframpTransaction.ts"

echo ""
echo "🔔  Webhooks & Push"
echo "────────────────────────────────────────"

check_true "Webhook route exists in server" \
  test -d "$SERVER/api/webhooks"

check_true "Push token registration util exists" \
  test -f "$UTILS/pushNotifications.ts"

echo ""
echo "🏗️   Build"
echo "────────────────────────────────────────"

check_false "TypeScript compiles with no errors (app)" \
  bash -c "cd '$ROOT' && npx tsc --noEmit 2>&1 | grep -v node_modules | grep -q 'error TS'"

check_false "TypeScript compiles with no errors (server)" \
  bash -c "cd '$SERVER' && npx tsc --noEmit 2>&1 | grep -v node_modules | grep -q 'error TS'"

echo ""
echo "────────────────────────────────────────"
echo "  $PASS passed · $FAIL failed"
echo "────────────────────────────────────────"
echo ""

[ $FAIL -eq 0 ] || exit 1
