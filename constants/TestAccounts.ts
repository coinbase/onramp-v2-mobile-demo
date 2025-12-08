/**
 * TestFlight Test Account Configuration
 *
 * This file contains fixed credentials for Apple TestFlight reviewers
 * to test the app without needing real email/phone verification.
 *
 * SECURITY NOTE: These are MOCK credentials only. No real CDP account
 * is created. All wallet addresses and seed phrases are for testing only.
 */

export const TEST_ACCOUNTS = {
  // Accepted test emails (for TestFlight reviewers and internal testing)
  emails: [
    'reviewer@coinbase-demo.app',
    'devtest@coinbase-demo.app'
  ],
  email: 'reviewer@coinbase-demo.app', // Keep for backwards compatibility
  otp: '123456',
  phone: '+12345678901', // Standard test phone number (accepted by most APIs)
  smsCode: '654321',

  // Mock user ID for history fetching
  userId: '286ef934-f3b8-4e94-b61f-1f1a088ac95e',

  // Mock wallet addresses (consistent for testing)
  wallets: {
    evm: '0x88cF83FD9C2709cDcBe393C0862070887E29E6DE', // Smart Account for demo
    eoaDummy: '0xEE396A141b5Be1def56cb7f5726A9884be34F396', // Dummy EOA address for display
    solana: '7SsYQQFW1MMyYmeLEZyus4nW1Gxe8fwJRu4gtJf6GAnG'
  },

  // Mock seed phrase for export functionality (TestFlight only)
  seedPhrase: 'test flight review demo wallet please approve thank you coinbase reviewer mock seed phrase'
};

export function isTestAccount(email: string): boolean {
  const normalizedEmail = email.toLowerCase();
  return TEST_ACCOUNTS.emails.some(testEmail => testEmail.toLowerCase() === normalizedEmail);
}
