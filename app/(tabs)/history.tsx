import { getCurrentPartnerUserRef, isTestSessionActive } from "@/utils/sharedState";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View
} from "react-native";
import { CoinbaseAlert } from "../../components/ui/CoinbaseAlerts";
import { FailedTransactionBadge } from "../../components/ui/FailedTransactionCard";
import { COLORS } from "../../constants/Colors";
import { TEST_ACCOUNTS } from "../../constants/TestAccounts";
import { fetchTransactionHistory } from "../../utils/fetchTransactionHistory";
import { fetchOnrampEvents, type OnrampEvent } from "../../utils/fetchOnrampEvents";
import { getWebViewEvents, type WebViewEvent } from "../../utils/sharedState";
import { useCurrentUser, useGetAccessToken } from "@coinbase/cdp-hooks";


const { BLUE, DARK_BG, CARD_BG, BORDER, TEXT_PRIMARY, TEXT_SECONDARY, WHITE } = COLORS;

type Transaction = {
  transaction_id: string;
  status: string;
  payment_total: {
    value: string;
    currency: string;
  };
  purchase_currency: string;
  purchase_network: string;
  purchase_amount?: {
    value: string;
    currency: string;
  };
  payment_method?: string;
  created_at: string;
  partner_user_ref: string;
  wallet_address: string;
  tx_hash: string;
};

export default function History() {
  const { currentUser } = useCurrentUser();
  const { getAccessToken } = useGetAccessToken();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [currentUserRef, setCurrentUserRef] = useState<string | null>(null);
  const [nextPageKey, setNextPageKey] = useState<string | null>(null);
  const [events, setEvents] = useState<OnrampEvent[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [eventsExpanded, setEventsExpanded] = useState(true);
  const [webViewEvents, setWebViewEvents] = useState<WebViewEvent[]>([]);
  const [webViewEventsExpanded, setWebViewEventsExpanded] = useState(true);

  const [alertState, setAlertState] = useState<{
    visible: boolean;
    title: string;
    message: string;
    type: 'success' | 'error' | 'info';
  }>({
    visible: false,
    title: '',
    message: '',
    type: 'info'
  });

  const loadTransactions = useCallback(async (pageKey?: string, append: boolean = false) => {
    // Use CDP userId or test account userId for TestFlight
    const isTestFlight = isTestSessionActive();
    const userId = isTestFlight ? TEST_ACCOUNTS.userId : currentUser?.userId;

    if (!userId) {
      console.log('No user ID available yet');
      return;
    }

    console.log('🔍 [HISTORY] loadTransactions called:', {
      pageKey,
      append,
      userId,
      currentTxCount: transactions.length
    });

    try {
      // Set appropriate loading state
      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }

      const accessToken = await getAccessToken();
      const result = await fetchTransactionHistory(userId, pageKey, 10, accessToken || undefined);

      console.log('📊 [HISTORY] API result:', {
        receivedTxCount: result.transactions?.length || 0,
        hasNextPageKey: !!result.nextPageKey,
        nextPageKeyValue: result.nextPageKey
      });

      if (append) {
        // Append to existing transactions (infinite scroll)
        setTransactions(prev => {
          const newTxs = [...prev, ...(result.transactions || [])];
          console.log('📝 [HISTORY] Appending transactions:', {
            previousCount: prev.length,
            newCount: newTxs.length
          });
          return newTxs;
        });
      } else {
        // Replace transactions (initial load or refresh)
        setTransactions(result.transactions || []);
      }

      setNextPageKey(result.nextPageKey || null);
      console.log('✅ [HISTORY] nextPageKey updated to:', result.nextPageKey || 'null');

    } catch (error) {
      console.error("Failed to load transaction history:", error);
      setAlertState({
        visible: true,
        title: "Error",
        message: "Failed to load transaction history",
        type: 'error'
      });
    } finally {
      if (append) {
        setLoadingMore(false);
      } else {
        setLoading(false);
      }
    }
  }, [currentUser?.userId, getAccessToken, transactions.length]);

  const loadEvents = useCallback(async () => {
    setLoadingEvents(true);
    try {
      const isTestFlight = isTestSessionActive();
      const token = isTestFlight ? 'testflight-mock-token' : (await getAccessToken() || '');
      const result = await fetchOnrampEvents(token);
      setEvents(result);
    } catch (error) {
      console.error('❌ [EVENTS] Failed to load events:', error);
    } finally {
      setLoadingEvents(false);
    }
  }, [getAccessToken]);

  useFocusEffect(
    useCallback(() => {
      const isTestFlight = isTestSessionActive();
      const userId = isTestFlight ? TEST_ACCOUNTS.userId : currentUser?.userId;
      console.log('History tab focused, userId:', userId);
      setCurrentUserRef(userId || null);

      // Auto-load transactions and events when tab becomes active
      if (userId) {
        loadTransactions();
        loadEvents();
      }
      // WebView events are in-memory — just read them directly
      setWebViewEvents(getWebViewEvents());
    }, [currentUser?.userId, loadTransactions, loadEvents])
  );

  useEffect(() => {
    const isTestFlight = isTestSessionActive();
    const userId = isTestFlight ? TEST_ACCOUNTS.userId : currentUser?.userId;
    setCurrentUserRef(userId || null);

    // Load transactions when user is available
    if (userId) {
      loadTransactions();
    }
  }, [currentUser?.userId, loadTransactions]);


  const handleRefresh = useCallback(() => {
    loadTransactions(); // Call without parameters for refresh
  }, [loadTransactions]);

  const handleLoadMore = useCallback(() => {
    console.log('🔄 [HISTORY] handleLoadMore triggered:', {
      hasNextPageKey: !!nextPageKey,
      nextPageKey,
      loadingMore,
      loading
    });

    if (nextPageKey && !loadingMore && !loading) {
      console.log('✅ [HISTORY] Loading more transactions with pageKey:', nextPageKey);
      loadTransactions(nextPageKey, true); // Append mode
    } else {
      console.log('⚠️ [HISTORY] Skipping load more - conditions not met');
    }
  }, [nextPageKey, loadingMore, loading, loadTransactions]);

  const getStatusColor = (status: string) => {
    const normalizedStatus = status.toLowerCase();
    if (normalizedStatus.includes("completed") || normalizedStatus.includes("success")) {
      return "#00D632"; // Green
    }
    if (normalizedStatus.includes("pending") || normalizedStatus.includes("processing")) {
      return "#FF8500"; // Orange
    }
    if (normalizedStatus.includes("failed") || normalizedStatus.includes("error")) {
      return "#FF6B6B"; // Red
    }
    return TEXT_SECONDARY; // Default gray
  };

  const isFailedTransaction = (status: string) => {
    const normalizedStatus = status.toLowerCase();
    return normalizedStatus.includes("failed") || normalizedStatus.includes("error");
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const formatRelativeTime = (timestamp: string) => {
    const d = new Date(timestamp);
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  };

  const getEventColor = (eventType: string) => {
    const lower = eventType.toLowerCase();
    if (lower.includes('success') || lower.includes('commit')) return '#00D632';
    if (lower.includes('fail') || lower.includes('error') || lower.includes('cancel')) return '#FF6B6B';
    if (lower.includes('pending') || lower.includes('processing') || lower.includes('polling')) return '#FF8500';
    if (lower.includes('load')) return BLUE;
    return TEXT_SECONDARY;
  };

  const formatEventLabel = (eventType: string) => {
    // "onramp.transaction.pending_risk" → "Pending Risk"
    // "onramp_api.commit_success" → "Commit Success"
    const parts = eventType.split(/[._](?=[a-z])/);
    const label = parts.slice(-2).join(' ') || eventType;
    return label.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  };

  const renderTransaction = ({ item }: { item: Transaction }) => {
    const isFailed = isFailedTransaction(item.status);

    return (
      <View style={styles.transactionItem}>
        <View style={[styles.transactionIcon, isFailed && styles.transactionIconFailed]}>
          <Ionicons
            name={isFailed ? "alert-circle" : "swap-horizontal"}
            size={16}
            color={isFailed ? "#FF6B6B" : WHITE}
          />
        </View>
        <View style={styles.transactionContent}>
          {/* First row: Title and Amount */}
          <View style={styles.transactionRow}>
            <Text style={styles.transactionTitle}>
              {item.purchase_currency} Purchase
            </Text>
            <Text style={styles.transactionAmount}>
              ${item.payment_total.value}
            </Text>
          </View>

          {/* Second row: Network/Date and Status */}
          <View style={styles.transactionRow}>
            <Text style={styles.transactionSubtitle}>
              {item.purchase_network} • {formatDate(item.created_at)}
            </Text>
            <Text style={[styles.statusText, { color: getStatusColor(item.status) }]}>
              {item.status.replace(/ONRAMP_TRANSACTION_STATUS_/g, '').replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, l => l.toUpperCase())}
            </Text>
          </View>

          {/* Show support badge for failed transactions */}
          {isFailed && (
            <View style={styles.supportBadgeRow}>
              <FailedTransactionBadge transaction={item} />
            </View>
          )}
        </View>
      </View>
    );
  };

  const renderListHeader = () => (
    <>
      <View style={styles.userRefSection}>
        <Text style={styles.userRefLabel}>User ID:</Text>
        <Text style={styles.userRefValue}>{currentUserRef || "Loading..."}</Text>
      </View>

      {/* Webhook Events Card */}
      <View style={styles.eventsCard}>
        <Pressable style={styles.eventsCardHeader} onPress={() => setEventsExpanded(prev => !prev)}>
          <View style={styles.eventsCardTitleRow}>
            <View style={styles.eventsDot} />
            <Text style={styles.eventsCardTitle}>Webhook Events</Text>
            {loadingEvents && <ActivityIndicator size="small" color={BLUE} style={{ marginLeft: 8 }} />}
          </View>
          <Ionicons name={eventsExpanded ? 'chevron-up' : 'chevron-down'} size={16} color={TEXT_SECONDARY} />
        </Pressable>
        {eventsExpanded && (
          <View style={styles.eventsCardBody}>
            {events.length === 0 ? (
              <Text style={styles.eventsEmpty}>No events yet — make an onramp transaction to see live webhook events here</Text>
            ) : (
              events.map((event, index) => (
                <View key={`${event.transactionId}-${index}`} style={[styles.eventRow, index > 0 && styles.eventRowBorder]}>
                  <View style={[styles.eventColorBar, { backgroundColor: getEventColor(event.eventType) }]} />
                  <View style={styles.eventRowContent}>
                    <View style={styles.eventRowTop}>
                      <Text style={[styles.eventType, { color: getEventColor(event.eventType) }]}>{formatEventLabel(event.eventType)}</Text>
                      <Text style={styles.eventTime}>{formatRelativeTime(event.timestamp)}</Text>
                    </View>
                    {(event.amount || event.network) && (
                      <Text style={styles.eventMeta}>
                        {[event.amount && event.currency ? `${event.amount} ${event.currency}` : null, event.network, event.failureReason].filter(Boolean).join(' · ')}
                      </Text>
                    )}
                    {event.transactionId && <Text style={styles.eventTxId} numberOfLines={1}>{event.transactionId}</Text>}
                  </View>
                </View>
              ))
            )}
          </View>
        )}
      </View>

      {/* Apple Pay / Google Pay WebView Events */}
      <View style={styles.eventsCard}>
        <Pressable style={styles.eventsCardHeader} onPress={() => setWebViewEventsExpanded(prev => !prev)}>
          <View style={styles.eventsCardTitleRow}>
            <View style={[styles.eventsDot, { backgroundColor: '#FF8500' }]} />
            <Text style={styles.eventsCardTitle}>Apple Pay Events</Text>
          </View>
          <Ionicons name={webViewEventsExpanded ? 'chevron-up' : 'chevron-down'} size={16} color={TEXT_SECONDARY} />
        </Pressable>
        {webViewEventsExpanded && (
          <View style={styles.eventsCardBody}>
            {webViewEvents.length === 0 ? (
              <Text style={styles.eventsEmpty}>No events yet — start an Apple Pay or Google Pay transaction</Text>
            ) : (
              webViewEvents.map((event, index) => (
                <View key={`${event.eventName}-${index}`} style={[styles.eventRow, index > 0 && styles.eventRowBorder]}>
                  <View style={[styles.eventColorBar, { backgroundColor: getEventColor(event.eventName) }]} />
                  <View style={styles.eventRowContent}>
                    <View style={styles.eventRowTop}>
                      <Text style={[styles.eventType, { color: getEventColor(event.eventName) }]}>{formatEventLabel(event.eventName)}</Text>
                      <Text style={styles.eventTime}>{formatRelativeTime(event.timestamp)}</Text>
                    </View>
                    <Text style={styles.eventMeta}>{event.paymentMethod}</Text>
                    <Text style={styles.eventRaw}>
                      {JSON.stringify({ eventName: event.eventName, data: event.data ?? {} }, null, 2)}
                    </Text>
                  </View>
                </View>
              ))
            )}
          </View>
        )}
      </View>

      {transactions.length === 0 && (
        <View style={styles.emptyState}>
          <Ionicons name="time-outline" size={64} color={TEXT_SECONDARY} />
          <Text style={styles.emptyTitle}>No Transactions Yet</Text>
          <Text style={styles.emptyMessage}>
            {currentUserRef
              ? "Your transaction history will appear here after completing an onramp purchase"
              : "Sign in to view your transaction history"}
          </Text>
        </View>
      )}
    </>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Onramp Transaction History</Text>
        <Pressable
          onPress={handleRefresh}
          disabled={loading}
          style={({ pressed }) => [styles.refreshButton, pressed && { opacity: 0.7 }, loading && { opacity: 0.5 }]}
        >
          {loading ? <ActivityIndicator size="small" color={BLUE} /> : <Ionicons name="refresh" size={20} color={BLUE} />}
        </Pressable>
      </View>

      <FlatList
        data={transactions}
        renderItem={renderTransaction}
        keyExtractor={(item) => item.transaction_id}
        contentContainerStyle={styles.listContainer}
        showsVerticalScrollIndicator={false}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListHeaderComponent={renderListHeader}
        onEndReached={handleLoadMore}
        onEndReachedThreshold={0.5}
        ListFooterComponent={() =>
          loadingMore ? (
            <View style={styles.footerLoader}>
              <ActivityIndicator size="small" color={BLUE} />
              <Text style={styles.footerText}>Loading more...</Text>
            </View>
          ) : nextPageKey ? (
            <View style={styles.footerLoader}>
              <Text style={styles.footerText}>Scroll to load more</Text>
            </View>
          ) : transactions.length > 0 ? (
            <View style={styles.footerLoader}>
              <Text style={styles.footerText}>No more transactions</Text>
            </View>
          ) : null
        }
      />

      <CoinbaseAlert
        visible={alertState.visible}
        title={alertState.title}
        message={alertState.message}
        type={alertState.type}
        onConfirm={() => setAlertState(prev => ({ ...prev, visible: false }))}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: DARK_BG,    
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: CARD_BG,    
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  title: {
    fontSize: 20,
    fontWeight: "600",
    color: TEXT_PRIMARY,
  },
  refreshButton: {
    // secondary button style
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 16,                 
    padding: 12,
    alignItems: 'center',
    justifyContent: 'center',
    
    // Subtle shadow
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  userRefSection: {
    backgroundColor: CARD_BG,
    marginHorizontal: 20,
    marginTop: 16,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
  },
  userRefLabel: {
    fontSize: 14,
    fontWeight: "500",
    color: TEXT_SECONDARY,
    marginBottom: 4,
  },
  userRefValue: {
    fontSize: 12,
    fontFamily: "monospace",
    color: TEXT_PRIMARY,
    backgroundColor: DARK_BG,
    padding: 8,
    borderRadius: 6,
  },
  listContainer: {
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  transactionItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 16,
    paddingHorizontal: 16,
    backgroundColor: 'transparent',
  },
  transactionIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: CARD_BG, // Neutral background
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    marginTop: 2,
  },
  transactionIconFailed: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
  },
  supportBadgeRow: {
    marginTop: 8,
    alignItems: 'flex-start',
  },
  transactionAmount: {
    fontSize: 16,
    fontWeight: '600',
    color: TEXT_PRIMARY, // Neutral white text
    textAlign: 'right',
  },
  transactionContent: {
    flex: 1,
    gap: 6, // Space between the two rows
  },
  transactionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  transactionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: TEXT_PRIMARY,
    flex: 1, // Take up available space
  },
  transactionSubtitle: {
    fontSize: 14,
    color: TEXT_SECONDARY,
    flex: 1, // Take up available space
  },
  statusText: {
    fontSize: 12,
    fontWeight: '500',
    textAlign: 'right',
    paddingLeft: 8, // Small padding to separate from subtitle
  },
  separator: {
    height: 1,
    backgroundColor: BORDER,
    marginLeft: 68,
  },
  transactionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  transactionDate: {
    fontSize: 12,
    color: TEXT_SECONDARY,
    marginBottom: 4,
  },
  transactionId: {
    fontSize: 10,
    fontFamily: "monospace",
    color: TEXT_SECONDARY,
  },
  transactionHash: {
    fontSize: 10,
    fontFamily: "monospace",
    color: TEXT_SECONDARY,
    marginTop: 2,
  },
  emptyState: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 40,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: TEXT_PRIMARY,
    marginTop: 16,
    marginBottom: 8,
  },
  emptyMessage: {
    fontSize: 14,
    color: TEXT_SECONDARY,
    textAlign: "center",
    lineHeight: 20,
  },
  paginationButton: {
    backgroundColor: BLUE,            
    paddingHorizontal: 20,            
    paddingVertical: 12,
    borderRadius: 20,               
    minWidth: 80,
    alignItems: 'center',
    
    // Coinbase shadow
    shadowColor: BLUE,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  paginationButtonDisabled: {
    backgroundColor: BORDER,           // Gray when disabled
    shadowOpacity: 0,                 // No shadow when disabled
    elevation: 0,
  },
  paginationText: {
    color: WHITE,
    fontSize: 14,
    fontWeight: '600',                // Semibold
    textAlign: 'center',
  },
  paginationTextDisabled: {
    color: TEXT_SECONDARY,
  },
  pageNumber: {
    color: TEXT_PRIMARY,
    fontSize: 14,
    fontWeight: '500',
  },
  pageIndicator: {
    color: TEXT_PRIMARY,
    fontSize: 14,
    fontWeight: '500',
  },
  transactionInfo: {
    flex: 1,
  },
  transactionMeta: {
    alignItems: "flex-end",
  },
  paginationContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 20,
    backgroundColor: DARK_BG,
    gap: 16,
  },
  paginationArrow: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: CARD_BG,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: BORDER,
  },
  paginationArrowDisabled: {
    opacity: 0.3,
  },
  pageNumbers: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  currentPageNumber: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: BLUE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  currentPageText: {
    color: WHITE,
    fontSize: 14,
    fontWeight: '600',
  },
  pageNumbersText: {
    color: TEXT_SECONDARY,
    fontSize: 14,
  },
  footerLoader: {
    paddingVertical: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footerText: {
    marginTop: 8,
    fontSize: 12,
    color: TEXT_SECONDARY,
    textAlign: 'center',
  },
  eventsCard: {
    backgroundColor: CARD_BG,
    marginHorizontal: 20,
    marginTop: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    overflow: 'hidden',
  },
  eventsCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  eventsCardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  eventsDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: BLUE,
    marginRight: 8,
  },
  eventsCardTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: TEXT_PRIMARY,
  },
  eventsCardBody: {
    borderTopWidth: 1,
    borderTopColor: BORDER,
  },
  eventsEmpty: {
    fontSize: 13,
    color: TEXT_SECONDARY,
    textAlign: 'center',
    padding: 16,
    lineHeight: 18,
  },
  eventRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    paddingVertical: 10,
    paddingRight: 16,
  },
  eventRowBorder: {
    borderTopWidth: 1,
    borderTopColor: BORDER,
  },
  eventColorBar: {
    width: 3,
    borderRadius: 2,
    marginLeft: 12,
    marginRight: 10,
    minHeight: 20,
  },
  eventRowContent: {
    flex: 1,
    gap: 2,
  },
  eventRowTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  eventType: {
    fontSize: 13,
    fontWeight: '600',
  },
  eventTime: {
    fontSize: 12,
    color: TEXT_SECONDARY,
  },
  eventMeta: {
    fontSize: 12,
    color: TEXT_SECONDARY,
  },
  eventTxId: {
    fontSize: 10,
    fontFamily: 'monospace',
    color: TEXT_SECONDARY,
    opacity: 0.6,
  },
  eventRaw: {
    fontSize: 10,
    fontFamily: 'monospace',
    color: TEXT_SECONDARY,
    backgroundColor: DARK_BG,
    padding: 6,
    borderRadius: 4,
    marginTop: 4,
  },
});