import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { COLORS } from "../../constants/Colors";

export default function TabLayout() {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.CARD_BG }} edges={['top']}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: COLORS.BLUE,
          tabBarInactiveTintColor: COLORS.TEXT_SECONDARY,
          tabBarStyle: {
            backgroundColor: COLORS.CARD_BG,
            borderTopColor: COLORS.BORDER,
          },
        }}
      >
        <Tabs.Screen 
          name="index" 
          options={{ 
            title: 'Buy Crypto',
            tabBarIcon: ({ color, size }) => <Ionicons name="wallet" size={size} color={color} />
          }} 
        />
        <Tabs.Screen 
          name="history" 
          options={{ 
            title: 'History',
            tabBarIcon: ({ color, size }) => <Ionicons name="time" size={size} color={color} />
          }} 
        />
        <Tabs.Screen
          name="profile"
          options={{
            title: 'Wallet',
            tabBarIcon: ({ color, size }) => <Ionicons name="person" size={size} color={color} />
          }}
        />
      </Tabs>
    </SafeAreaView>
  );
}