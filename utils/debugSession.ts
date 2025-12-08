/**
 * Session Persistence Debug Utility for TestFlight
 *
 * Checks SecureStore for CDP tokens and displays results in UI alerts
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

// CDP SDK likely uses keys like these (common patterns)
// Note: SecureStore only allows alphanumeric, ".", "-", "_" in key names
const CDP_KEYS = [
  // Standard CDP keys (underscore notation)
  'cdp_access_token',
  'cdp_refresh_token',
  'cdp_id_token',
  'cdp_user_id',
  'cdp_session',
  'cdp_wallet_data',
  'cdp_credentials',
  'cdp_auth_state',

  // Simple auth keys
  'accessToken',
  'refreshToken',
  'idToken',
  'auth_token',
  'session_token',
  'user_session',

  // Coinbase namespaced (valid characters only)
  'coinbase_access_token',
  'coinbase_refresh_token',
  'coinbase_session',
  'coinbase_credentials',
  'coinbase.access_token',
  'coinbase.refresh_token',
  'coinbase.session',

  // Domain-style keys (dots are valid)
  'com.coinbase.cdp.access_token',
  'com.coinbase.cdp.refresh_token',
  'com.coinbase.cdp.session',
  'com.coinbase.access_token',
  'com.coinbase.refresh_token',

  // Dashed notation
  'cdp-access-token',
  'cdp-refresh-token',
  'cdp-session',
];

/**
 * Check SecureStore for CDP session data
 * Returns a formatted string suitable for display in an alert
 */
export async function debugSecureStoreSession(): Promise<string> {
  const results: string[] = [];

  results.push('🔍 SESSION DEBUG\n');
  results.push(`Time: ${new Date().toLocaleTimeString()}\n`);

  // Test if SecureStore works at all
  const testKey = 'test_debug_temp';
  const testValue = `test_${Date.now()}`;

  try {
    await SecureStore.setItemAsync(testKey, testValue);
    const readBack = await SecureStore.getItemAsync(testKey);
    await SecureStore.deleteItemAsync(testKey);

    if (readBack === testValue) {
      results.push('✅ SecureStore: WORKING\n');
    } else {
      results.push('⚠️ SecureStore: READ MISMATCH\n');
    }
  } catch (error: any) {
    results.push(`❌ SecureStore: BROKEN\n${error.message}\n`);
    return results.join('\n');
  }

  // Check for CDP tokens
  results.push('--- CDP Tokens ---');
  let foundTokens = 0;

  for (const key of CDP_KEYS) {
    try {
      const value = await SecureStore.getItemAsync(key);
      if (value) {
        foundTokens++;
        const preview = value.length > 20
          ? `${value.substring(0, 8)}...`
          : '[SHORT]';
        results.push(`✅ ${key}`);
        results.push(`   Length: ${value.length} chars`);
        results.push(`   Preview: ${preview}`);
      }
    } catch (error: any) {
      results.push(`⚠️ ${key}: ${error.message}`);
    }
  }

  if (foundTokens === 0) {
    results.push('\n❌ NO TOKENS IN SECURESTORE');
  } else {
    results.push(`\n✅ Found ${foundTokens} token(s) in SecureStore`);
  }

  // Also check AsyncStorage (CDP might fallback to this)
  results.push('\n--- AsyncStorage Check ---');
  let asyncTokens = 0;

  try {
    for (const key of CDP_KEYS) {
      const value = await AsyncStorage.getItem(key);
      if (value) {
        asyncTokens++;
        results.push(`✅ ${key} (AsyncStorage)`);
      }
    }

    // Also try to get all AsyncStorage keys
    const allKeys = await AsyncStorage.getAllKeys();
    const cdpKeys = allKeys.filter(k =>
      k.toLowerCase().includes('cdp') ||
      k.toLowerCase().includes('coinbase') ||
      k.toLowerCase().includes('token') ||
      k.toLowerCase().includes('session')
    );

    if (cdpKeys.length > 0) {
      results.push(`\nFound ${cdpKeys.length} CDP-related keys in AsyncStorage:`);
      for (const key of cdpKeys.slice(0, 10)) { // Limit to 10
        const value = await AsyncStorage.getItem(key);
        if (value) {
          results.push(`  - ${key} (${value.length} chars)`);
        }
      }
    }
  } catch (error: any) {
    results.push(`⚠️ AsyncStorage check failed: ${error.message}`);
  }

  if (foundTokens === 0 && asyncTokens === 0) {
    results.push('\n❌ NO CDP TOKENS FOUND ANYWHERE');
    results.push('Session won\'t persist on restart!');
    results.push('\nThis is a CDP SDK bug.');
    results.push('SDK v0.0.57 may not be saving tokens.');
  }

  return results.join('\n');
}

/**
 * Test SecureStore basic functionality
 */
export async function testSecureStoreFunctionality(): Promise<string> {
  const results: string[] = [];
  const testKey = 'test_persistence_check';
  const testValue = `test_${Date.now()}`;

  results.push('🧪 SECURESTORE TEST\n');

  // Write test
  try {
    await SecureStore.setItemAsync(testKey, testValue);
    results.push('✅ Write: SUCCESS');
  } catch (error: any) {
    results.push(`❌ Write: FAILED\n${error.message}`);
    return results.join('\n');
  }

  // Read test
  try {
    const value = await SecureStore.getItemAsync(testKey);
    if (value === testValue) {
      results.push('✅ Read: SUCCESS (match)');
    } else {
      results.push(`⚠️ Read: MISMATCH\nGot: ${value}\nExpected: ${testValue}`);
    }
  } catch (error: any) {
    results.push(`❌ Read: FAILED\n${error.message}`);
  }

  // Delete test
  try {
    await SecureStore.deleteItemAsync(testKey);
    const afterDelete = await SecureStore.getItemAsync(testKey);
    if (afterDelete === null) {
      results.push('✅ Delete: SUCCESS');
    } else {
      results.push('⚠️ Delete: FAILED (still exists)');
    }
  } catch (error: any) {
    results.push(`❌ Delete: FAILED\n${error.message}`);
  }

  return results.join('\n');
}
