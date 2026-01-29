/**
 * FailedTransactionCard - Error UI for failed transactions
 *
 * Displays error message and provides easy access to support.
 * Matches the Coinbase Onramp error screen design.
 */

import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { COLORS } from '../../constants/Colors';
import {
  createDebugInfoFromTransaction,
  GuestCheckoutDebugInfo,
  openSupportEmail,
  SUPPORT_EMAIL,
  TransactionDebugInfo
} from '../../utils/supportEmail';

const { BLUE, CARD_BG, BORDER, TEXT_PRIMARY, TEXT_SECONDARY, WHITE, DARK_BG } = COLORS;

interface FailedTransactionCardProps {
  title?: string;
  message?: string;
  transaction?: {
    transaction_id?: string;
    status?: string;
    purchase_currency?: string;
    purchase_network?: string;
    purchase_amount?: { value?: string; currency?: string } | string;
    payment_total?: { value?: string; currency?: string };
    payment_method?: string;
    wallet_address?: string;
    tx_hash?: string;
    created_at?: string;
    partner_user_ref?: string;
  };
  debugInfo?: TransactionDebugInfo | GuestCheckoutDebugInfo;
  errorMessage?: string;
  onDismiss?: () => void;
  showDismiss?: boolean;
}

export function FailedTransactionCard({
  title = 'An error occurred',
  message = "We're looking into it right now. Please try again later.",
  transaction,
  debugInfo,
  errorMessage,
  onDismiss,
  showDismiss = true,
}: FailedTransactionCardProps) {
  // Use provided debugInfo or create from transaction
  const finalDebugInfo = debugInfo || (transaction
    ? createDebugInfoFromTransaction(transaction, errorMessage)
    : undefined);

  const handleContactSupport = async () => {
    if (finalDebugInfo) {
      await openSupportEmail(finalDebugInfo);
    } else {
      // Fallback - open email with minimal info
      await openSupportEmail({
        flowType: 'guest',
        partnerName: 'Onramp V2 Demo',
        errorMessage: errorMessage || message,
      } as GuestCheckoutDebugInfo);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>{title}</Text>

        {/* Error illustration - using Ionicons as fallback */}
        <View style={styles.illustrationContainer}>
          <View style={styles.illustration}>
            <Ionicons name="alert-circle" size={80} color="#FF6B6B" />
          </View>
        </View>

        <Text style={styles.heading}>Something went wrong</Text>
        <Text style={styles.message}>{message}</Text>

        {/* Support contact section */}
        <View style={styles.supportSection}>
          <Text style={styles.contactText}>
            Contact{' '}
            <Text style={styles.emailLink} onPress={handleContactSupport}>
              {SUPPORT_EMAIL}
            </Text>
            {' '}for support.
          </Text>
          <Text style={styles.responseTime}>
            We'll resolve the issue within 1 business day.
          </Text>
        </View>

        {/* Action buttons */}
        <View style={styles.buttonContainer}>
          <Pressable
            onPress={handleContactSupport}
            style={({ pressed }) => [
              styles.primaryButton,
              pressed && styles.buttonPressed,
            ]}
          >
            <Ionicons name="mail-outline" size={20} color={WHITE} />
            <Text style={styles.primaryButtonText}>Email Support</Text>
          </Pressable>

          {showDismiss && onDismiss && (
            <Pressable
              onPress={onDismiss}
              style={({ pressed }) => [
                styles.secondaryButton,
                pressed && styles.buttonPressed,
              ]}
            >
              <Text style={styles.secondaryButtonText}>Dismiss</Text>
            </Pressable>
          )}
        </View>

        {/* Secured by Coinbase footer */}
        <View style={styles.footer}>
          <Ionicons name="lock-closed" size={14} color={TEXT_SECONDARY} />
          <Text style={styles.footerText}>Secured by coinbase</Text>
        </View>
      </View>
    </View>
  );
}

/**
 * Compact version for inline display in transaction lists
 */
export function FailedTransactionBadge({
  transaction,
  onPress,
}: {
  transaction: {
    transaction_id?: string;
    status?: string;
    purchase_currency?: string;
    purchase_network?: string;
    purchase_amount?: { value?: string; currency?: string } | string;
    payment_total?: { value?: string; currency?: string };
    payment_method?: string;
    wallet_address?: string;
    tx_hash?: string;
    created_at?: string;
    partner_user_ref?: string;
  };
  onPress?: () => void;
}) {
  const handlePress = async () => {
    if (onPress) {
      onPress();
    } else {
      const debugInfo = createDebugInfoFromTransaction(transaction);
      await openSupportEmail(debugInfo);
    }
  };

  return (
    <Pressable
      onPress={handlePress}
      style={({ pressed }) => [
        styles.badge,
        pressed && styles.badgePressed,
      ]}
    >
      <Ionicons name="mail-outline" size={14} color={BLUE} />
      <Text style={styles.badgeText}>Get Help</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    backgroundColor: DARK_BG,
  },
  card: {
    backgroundColor: WHITE,
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 400,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 5,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 24,
  },
  illustrationContainer: {
    marginBottom: 24,
  },
  illustration: {
    width: 120,
    height: 120,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FEF2F2',
    borderRadius: 60,
  },
  heading: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1a1a1a',
    marginBottom: 8,
    textAlign: 'center',
  },
  message: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 20,
  },
  supportSection: {
    alignItems: 'center',
    marginBottom: 24,
  },
  contactText: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
  },
  emailLink: {
    color: BLUE,
    textDecorationLine: 'underline',
    fontWeight: '500',
  },
  responseTime: {
    fontSize: 12,
    color: TEXT_SECONDARY,
    marginTop: 4,
  },
  buttonContainer: {
    width: '100%',
    gap: 12,
  },
  primaryButton: {
    backgroundColor: BLUE,
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 25,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  primaryButtonText: {
    color: WHITE,
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryButton: {
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  secondaryButtonText: {
    color: '#1a1a1a',
    fontSize: 16,
    fontWeight: '600',
  },
  buttonPressed: {
    opacity: 0.8,
    transform: [{ scale: 0.98 }],
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 24,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
    width: '100%',
    justifyContent: 'center',
  },
  footerText: {
    fontSize: 12,
    color: TEXT_SECONDARY,
    fontWeight: '500',
  },
  // Badge styles for compact inline display
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#EBF5FF',
    borderRadius: 12,
    marginTop: 8,
  },
  badgePressed: {
    opacity: 0.7,
  },
  badgeText: {
    fontSize: 12,
    color: BLUE,
    fontWeight: '500',
  },
});
