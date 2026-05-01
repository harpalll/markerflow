import { useRef, useState, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  SafeAreaView,
  ScrollView,
  Image,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { REQUIRED_MARKERS, OUTPUT_SIZE } from '../constants/scanner';
import type { ProcessedMarker } from '../types/marker';

type Screen = 'scanner' | 'results';

export function ScannerScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [screen, setScreen] = useState<Screen>('scanner');
  const [scanning, setScanning] = useState(false);
  const [markers, setMarkers] = useState<ProcessedMarker[]>([]);
  const [status, setStatus] = useState('Ready to scan');
  const cameraRef = useRef<CameraView>(null);
  const cameraReady = useRef(false);

  const handleCameraReady = useCallback(() => {
    cameraReady.current = true;
  }, []);

  const startScan = useCallback(() => {
    if (!cameraReady.current) return;
    setScanning(true);
    setStatus('Scanning...');
  }, []);

  const stopScan = useCallback(() => {
    setScanning(false);
    setStatus('Paused');
  }, []);

  const reset = useCallback(() => {
    setScanning(false);
    setMarkers([]);
    setStatus('Ready to scan');
  }, []);

  if (!permission) {
    return (
      <View style={styles.center}>
        <Text style={styles.text}>Requesting camera permission...</Text>
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.text}>Camera access is required to scan markers.</Text>
        <TouchableOpacity style={styles.btn} onPress={requestPermission}>
          <Text style={styles.btnText}>Grant Permission</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (screen === 'results') {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.header}>
          <Text style={styles.title}>Detected Markers ({markers.length})</Text>
          <TouchableOpacity onPress={() => setScreen('scanner')}>
            <Text style={styles.link}>Back</Text>
          </TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={styles.grid}>
          {markers.map((m, i) => (
            <View key={m.id} style={styles.markerCard}>
              <Image
                source={{ uri: m.uri }}
                style={{ width: OUTPUT_SIZE, height: OUTPUT_SIZE }}
                resizeMode="contain"
              />
              <Text style={styles.markerLabel}>#{i + 1}</Text>
            </View>
          ))}
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.root}>
      <CameraView
        ref={cameraRef}
        style={styles.camera}
        facing="back"
        onCameraReady={handleCameraReady}
      >
        {/* guide overlay */}
        <View style={styles.overlay}>
          <View style={styles.guideBox} />
        </View>
      </CameraView>

      <SafeAreaView style={styles.controls}>
        <Text style={styles.status}>{status}</Text>
        <Text style={styles.count}>
          {markers.length} / {REQUIRED_MARKERS}
        </Text>

        <View style={styles.btnRow}>
          {!scanning ? (
            <TouchableOpacity
              style={[styles.btn, styles.btnPrimary]}
              onPress={startScan}
            >
              <Text style={styles.btnText}>Start Scan</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[styles.btn, styles.btnWarn]}
              onPress={stopScan}
            >
              <Text style={styles.btnText}>Stop</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity style={styles.btn} onPress={reset}>
            <Text style={styles.btnText}>Reset</Text>
          </TouchableOpacity>

          {markers.length > 0 && (
            <TouchableOpacity
              style={[styles.btn, styles.btnPrimary]}
              onPress={() => setScreen('results')}
            >
              <Text style={styles.btnText}>Results</Text>
            </TouchableOpacity>
          )}
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000',
  },
  center: {
    flex: 1,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  camera: {
    flex: 1,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  guideBox: {
    width: 260,
    height: 260,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.6)',
    borderRadius: 8,
  },
  controls: {
    backgroundColor: '#111',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 24,
  },
  status: {
    color: '#aaa',
    fontSize: 14,
    textAlign: 'center',
  },
  count: {
    color: '#fff',
    fontSize: 28,
    fontWeight: '700',
    textAlign: 'center',
    marginVertical: 8,
  },
  btnRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
    marginTop: 8,
  },
  btn: {
    backgroundColor: '#333',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  btnPrimary: {
    backgroundColor: '#2563eb',
  },
  btnWarn: {
    backgroundColor: '#dc2626',
  },
  btnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  text: {
    color: '#fff',
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
  },
  title: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
  link: {
    color: '#60a5fa',
    fontSize: 15,
  },
  grid: {
    alignItems: 'center',
    paddingVertical: 16,
    gap: 16,
  },
  markerCard: {
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
    borderRadius: 8,
    padding: 8,
  },
  markerLabel: {
    color: '#888',
    fontSize: 12,
    marginTop: 4,
  },
});
