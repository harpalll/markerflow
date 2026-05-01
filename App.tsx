import { useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View, TouchableOpacity, Text, Platform } from 'react-native';
import { ScannerScreen } from './src/components/ScannerScreen';
import { TestHarness } from './src/components/TestHarness';

const STATUS_BAR_HEIGHT = Platform.OS === 'android' ? 36 : 0;

type Tab = 'scanner' | 'tests';

export default function App() {
  const [tab, setTab] = useState<Tab>('tests');

  return (
    <View style={styles.root}>
      <StatusBar style="light" />

      {tab === 'scanner' ? <ScannerScreen /> : <TestHarness />}

      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tab, tab === 'scanner' && styles.tabActive]}
          onPress={() => setTab('scanner')}
          activeOpacity={0.7}
        >
          <Text style={[styles.tabText, tab === 'scanner' && styles.tabTextActive]}>
            Scanner
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, tab === 'tests' && styles.tabActive]}
          onPress={() => setTab('tests')}
          activeOpacity={0.7}
        >
          <Text style={[styles.tabText, tab === 'tests' && styles.tabTextActive]}>
            Tests
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000',
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#111',
    borderTopWidth: 1,
    borderTopColor: '#222',
    paddingBottom: Platform.OS === 'android' ? 8 : 20,
  },
  tab: {
    flex: 1,
    paddingVertical: 14,
    alignItems: 'center',
  },
  tabActive: {
    borderBottomWidth: 2,
    borderBottomColor: '#2563eb',
  },
  tabText: {
    color: '#666',
    fontSize: 15,
    fontWeight: '600',
  },
  tabTextActive: {
    color: '#fff',
  },
});
