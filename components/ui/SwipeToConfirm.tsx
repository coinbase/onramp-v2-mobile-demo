import Ionicons from "@expo/vector-icons/Ionicons";
import React, { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Animated, PanResponder, StyleSheet, Text, View } from "react-native";
import { COLORS } from "../../constants/Colors";

const { BLUE, CARD_BG, BORDER, TEXT_PRIMARY, TEXT_SECONDARY, BLACK, WHITE, SILVER } = COLORS;

type SwipeToConfirmProps = {
  label: string;
  disabled?: boolean;
  onConfirm: (reset: () => void) => void;
  isLoading?: boolean;
  onSwipeStart?: () => void;
  onSwipeEnd?: () => void;
};


export function SwipeToConfirm({ label, disabled = false, onConfirm, isLoading = false, onSwipeStart, onSwipeEnd }: SwipeToConfirmProps) {
  const [trackWidth, setTrackWidth] = useState(0);
  const knobSize = 48;
  const horizontalPadding = 4;
  const maxX = Math.max(0, trackWidth - knobSize - horizontalPadding * 2);

  const translateX = useRef(new Animated.Value(0)).current;
  const startXRef = useRef(0);
  const currentXRef = useRef(0);

  const snapBack = useCallback(() => {
    // Remove the isLoading check - back to original
    Animated.spring(translateX, { toValue: 0, useNativeDriver: false, bounciness: 6, speed: 12 }).start(() => {
      currentXRef.current = 0;
    });
  }, [translateX]); // Remove isLoading dependency

  const complete = useCallback(() => {
    Animated.timing(translateX, { toValue: maxX, duration: 150, useNativeDriver: false }).start(() => {
      currentXRef.current = maxX;
      const reset = () => snapBack();
      onConfirm(reset);
    });
  }, [maxX, onConfirm, snapBack, translateX]);

  // Add effect to handle loading state changes
  React.useEffect(() => {
    if (isLoading) {
      // Move to complete position when loading starts
      Animated.timing(translateX, { 
        toValue: maxX, 
        duration: 200, 
        useNativeDriver: false 
      }).start(() => {
        currentXRef.current = maxX;
      });
    } else {
      // Always reset when loading ends (remove the position check)
      setTimeout(() => {
        Animated.spring(translateX, { 
          toValue: 0, 
          useNativeDriver: false, 
          bounciness: 6, 
          speed: 12 
        }).start(() => {
          currentXRef.current = 0;
        });
      }, 300);
    }
  }, [isLoading, maxX, translateX]);

  const pan = React.useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !disabled && !isLoading, // Disable during loading
        onMoveShouldSetPanResponder: (_e, g) => !disabled && !isLoading && Math.abs(g.dx) > Math.abs(g.dy) && Math.abs(g.dx) > 5,
        onStartShouldSetPanResponderCapture: () => !disabled && !isLoading,
        onMoveShouldSetPanResponderCapture: () => !disabled && !isLoading,
        onPanResponderGrant: (e) => {
          if (isLoading) return; // Extra safety check
          onSwipeStart?.();
          const localX = e.nativeEvent.locationX - knobSize / 2;
          const clamped = Math.max(0, Math.min(maxX, localX));
          startXRef.current = clamped;
          currentXRef.current = clamped;
          translateX.setValue(clamped);
        },
        onPanResponderMove: (_e, g) => {
          if (isLoading) return; // Extra safety check
          const next = Math.max(0, Math.min(maxX, startXRef.current + g.dx));
          currentXRef.current = next;
          translateX.setValue(next);
        },
        onPanResponderRelease: () => {
          // Gesture completion can race with submission state. Always release
          // the parent ScrollView before honoring the loading guard.
          onSwipeEnd?.();
          if (isLoading) return;
          const threshold = maxX * 0.8;
          if (currentXRef.current >= threshold) {
            complete();
          } else {
            snapBack();
          }
        },
        onPanResponderTerminationRequest: () => false,
        onPanResponderTerminate: () => {
          // Termination happens when a modal/loading state steals the gesture.
          // Cleanup must run even then or Buy stays permanently unscrollable.
          onSwipeEnd?.();
          if (!isLoading) snapBack();
        },
      }),
    [disabled, knobSize, maxX, complete, snapBack, translateX, isLoading, onSwipeStart, onSwipeEnd] 
  );

  const progressWidth = Animated.add(translateX, new Animated.Value(knobSize));

  return (
    <View style={[styles.swipeContainer, disabled && { opacity: 0.5 }]}>
      <View
        style={styles.swipeTrack}
        onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}
        {...(!isLoading ? pan.panHandlers : {})} // Only apply pan handlers when not loading
        accessibilityRole="button"
        accessibilityState={{ disabled: disabled || isLoading }}
        accessibilityLabel={label}
      >
        <Animated.View style={[styles.swipeProgress, { width: progressWidth }]} />
        
        {/* Center text - show spinner OR label */}
        {isLoading ? (
          <ActivityIndicator size="small" color={TEXT_PRIMARY} />
        ) : (
          <Text style={styles.swipeLabel}>{label}</Text>
        )}
        
        {/* Knob - always show chevron */}
        <Animated.View style={[styles.swipeKnob, { transform: [{ translateX }] }]}>
          <Ionicons name="chevron-forward" size={22} color="#FFFFFF" />
        </Animated.View>
      </View>
    </View>
  );
}


const styles = StyleSheet.create({
  swipeContainer: {
    marginTop: 8,
  },
  swipeTrack: {
    height: 56,
    borderRadius: 28,
    backgroundColor: CARD_BG, 
    borderColor: SILVER,        
    borderWidth: 1,           
    overflow: "hidden",
    justifyContent: "center",
    position: 'relative',    
  },
  swipeProgress: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: BLUE,
    opacity: 0.15,
    borderRadius: 28,              
  },
  swipeLabel: {
    textAlign: "center",
    color: TEXT_PRIMARY,
    fontSize: 16,
    fontWeight: "500",      
  },
  swipeKnob: {
    position: "absolute",
    left: 4,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: BLUE,  
    alignItems: "center",
    justifyContent: "center",
    shadowColor: BLUE,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
});