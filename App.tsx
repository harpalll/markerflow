import { useState, useCallback } from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View, TouchableOpacity, Text, Platform, ActivityIndicator } from 'react-native';
import { useFonts } from 'expo-font';
import { Ionicons } from '@expo/vector-icons';
import { ScannerScreen } from './src/components/ScannerScreen';
import { TestHarness } from './src/components/TestHarness';

type Tab = 'scanner' | 'tests';

const TABS: { key: Tab; label: string; icon: keyof typeof Ionicons.glyphMap; iconActive: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'scanner', label: 'Scanner', icon: 'scan-outline', iconActive: 'scan' },
  { key: 'tests', label: 'Tests', icon: 'checkmark-circle-outline', iconActive: 'checkmark-circle' },
];

export default function App() {
  const [tab, setTab] = useState<Tab>('scanner');
  const [fontsLoaded] = useFonts(Ionicons.font);

  if (!fontsLoaded) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color="#60a5fa" size="large" />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar style="light" />

      {tab === 'scanner' ? <ScannerScreen /> : <TestHarness />}

      <View style={styles.tabBar}>
        {TABS.map(t => {
          const active = tab === t.key;
          return (
            <TouchableOpacity
              key={t.key}
              style={styles.tab}
              onPress={() => setTab(t.key)}
              activeOpacity={0.7}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={t.label}
            >
              <Ionicons
                name={active ? t.iconActive : t.icon}
                size={22}
                color={active ? '#60a5fa' : '#555'}
              />
              <Text style={[styles.tabText, active && styles.tabTextActive]}>
                {t.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  loading: {
    flex: 1,
    backgroundColor: '#0a0a0a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#0f0f0f',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#1f1f1f',
    paddingBottom: Platform.OS === 'android' ? 10 : 24,
    paddingTop: 8,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    paddingVertical: 4,
  },
  tabText: {
    color: '#555',
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.2,
  },
  tabTextActive: {
    color: '#60a5fa',
  },
});
