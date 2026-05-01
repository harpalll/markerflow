import { useState, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ScrollView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { detectMarker1 } from '../utils/marker/detectMarker1';
import {
  generateMarker1,
  generateBorderOnly,
  generateLargeAnchor,
  generateCenterBlock,
  generateHeavyFill,
  generateLargeUpperLeftBlock,
  generateOffCenterBlock,
} from '../utils/marker/fixtures';
import type { DetectionResult } from '../types/marker';

interface TestCase {
  name: string;
  expected: 'accept' | 'reject';
  generate: () => ReturnType<typeof generateMarker1>;
}

const TESTS: TestCase[] = [
  {
    name: 'Valid — anchor top-left',
    expected: 'accept',
    generate: () => generateMarker1(300, 'top-left'),
  },
  {
    name: 'Valid — anchor top-right',
    expected: 'accept',
    generate: () => generateMarker1(300, 'top-right'),
  },
  {
    name: 'Valid — anchor bottom-right',
    expected: 'accept',
    generate: () => generateMarker1(300, 'bottom-right'),
  },
  {
    name: 'Valid — anchor bottom-left',
    expected: 'accept',
    generate: () => generateMarker1(300, 'bottom-left'),
  },
  {
    name: 'Reject — border only, no anchor',
    expected: 'reject',
    generate: () => generateBorderOnly(300),
  },
  {
    name: 'Reject — oversized corner anchor',
    expected: 'reject',
    generate: () => generateLargeAnchor(300),
  },
  {
    name: 'Reject — center black block',
    expected: 'reject',
    generate: () => generateCenterBlock(300),
  },
  {
    name: 'Reject — heavy inner fill',
    expected: 'reject',
    generate: () => generateHeavyFill(300),
  },
  {
    name: 'Reject — large upper-left block',
    expected: 'reject',
    generate: () => generateLargeUpperLeftBlock(300),
  },
  {
    name: 'Reject — off-center block (not in corner)',
    expected: 'reject',
    generate: () => generateOffCenterBlock(300),
  },
];

interface TestResult {
  name: string;
  expected: 'accept' | 'reject';
  actual: 'accept' | 'reject';
  passed: boolean;
  detail: string;
  timeMs: number;
}

export function TestHarness() {
  const [results, setResults] = useState<TestResult[]>([]);
  const [running, setRunning] = useState(false);

  const runTests = useCallback(() => {
    setRunning(true);
    setResults([]);

    // defer to let the UI update
    setTimeout(() => {
      const out: TestResult[] = [];

      for (const tc of TESTS) {
        const img = tc.generate();
        const t0 = Date.now();
        const det: DetectionResult = detectMarker1(img);
        const elapsed = Date.now() - t0;

        const actual = det.ok ? 'accept' : 'reject';
        const passed = actual === tc.expected;

        let detail: string;
        if (det.ok) {
          detail = `anchor=${det.anchor} conf=${det.confidence.toFixed(2)}`;
        } else {
          detail = det.reason;
        }

        out.push({
          name: tc.name,
          expected: tc.expected,
          actual,
          passed,
          detail,
          timeMs: elapsed,
        });
      }

      setResults(out);
      setRunning(false);
    }, 50);
  }, []);

  const passCount = results.filter(r => r.passed).length;
  const total = results.length;

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title}>Detection Tests</Text>
        <TouchableOpacity
          style={[styles.btn, running && styles.btnDisabled]}
          onPress={runTests}
          disabled={running}
          activeOpacity={0.7}
        >
          <Ionicons name={running ? 'hourglass' : 'play'} size={14} color="#fff" />
          <Text style={styles.btnText}>{running ? 'Running...' : 'Run All'}</Text>
        </TouchableOpacity>
      </View>

      {total > 0 && (
        <View style={styles.summaryRow}>
          <Ionicons
            name={passCount === total ? 'checkmark-circle' : 'alert-circle'}
            size={18}
            color={passCount === total ? '#22c55e' : '#ef4444'}
          />
          <Text style={[styles.summary, passCount === total ? styles.allPass : styles.someFail]}>
            {passCount}/{total} passed
          </Text>
        </View>
      )}

      {total === 0 && !running && (
        <View style={styles.empty}>
          <Ionicons name="flask-outline" size={36} color="#333" />
          <Text style={styles.emptyText}>Tap Run All to validate the detection pipeline</Text>
        </View>
      )}

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {results.map((r, i) => (
          <View key={i} style={[styles.card, r.passed ? styles.cardPass : styles.cardFail]}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardName}>{r.name}</Text>
              <Text style={r.passed ? styles.pass : styles.fail}>
                {r.passed ? 'PASS' : 'FAIL'}
              </Text>
            </View>
            <Text style={styles.cardDetail}>
              expected={r.expected} actual={r.actual}
            </Text>
            <Text style={styles.cardDetail}>
              {r.detail} ({r.timeMs}ms)
            </Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'android' ? 48 : 56,
    paddingBottom: 8,
  },
  title: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
  },
  btn: {
    backgroundColor: '#2563eb',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 8,
  },
  btnDisabled: {
    opacity: 0.5,
  },
  btnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  summary: {
    fontSize: 14,
    fontWeight: '700',
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginVertical: 8,
  },
  allPass: { color: '#22c55e' },
  someFail: { color: '#ef4444' },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
    gap: 12,
  },
  emptyText: {
    color: '#555',
    fontSize: 13,
    textAlign: 'center',
  },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingBottom: 32 },
  card: {
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    borderLeftWidth: 4,
  },
  cardPass: {
    backgroundColor: '#0f1f0f',
    borderLeftColor: '#22c55e',
  },
  cardFail: {
    backgroundColor: '#1f0f0f',
    borderLeftColor: '#ef4444',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  cardName: {
    color: '#ddd',
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
  },
  pass: { color: '#22c55e', fontWeight: '700', fontSize: 13 },
  fail: { color: '#ef4444', fontWeight: '700', fontSize: 13 },
  cardDetail: {
    color: '#888',
    fontSize: 12,
    marginTop: 2,
    fontFamily: 'monospace',
  },
});
