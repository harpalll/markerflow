import { useRef, useState, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  SafeAreaView,
  ScrollView,
  Image,
  ActivityIndicator,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { REQUIRED_MARKERS, OUTPUT_SIZE, DETECTION_DOWNSCALE, CAPTURE_QUALITY } from '../constants/scanner';
import { decodeJpegFromBase64 } from '../utils/image/decodeJpeg';
import { downscale } from '../utils/image/pixelUtils';
import { detectMarker1 } from '../utils/marker/detectMarker1';
import { rotationForAnchor } from '../utils/marker/orientation';
import type { ProcessedMarker, DetectionResult } from '../types/marker';

type Screen = 'scanner' | 'results';

export function ScannerScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [screen, setScreen] = useState<Screen>('scanner');
  const [markers, setMarkers] = useState<ProcessedMarker[]>([]);
  const [status, setStatus] = useState('Ready — tap Capture to detect');
  const [processing, setProcessing] = useState(false);
  const cameraRef = useRef<CameraView>(null);
  const cameraReady = useRef(false);

  const handleCameraReady = useCallback(() => {
    cameraReady.current = true;
  }, []);

  const captureAndDetect = useCallback(async () => {
    if (!cameraReady.current || !cameraRef.current || processing) return;
    if (markers.length >= REQUIRED_MARKERS) {
      setStatus(`Done — ${REQUIRED_MARKERS} markers collected`);
      return;
    }

    setProcessing(true);
    setStatus('Capturing...');

    try {
      const photo = await cameraRef.current.takePictureAsync({
        base64: true,
        quality: CAPTURE_QUALITY,
        shutterSound: false,
      });

      if (!photo?.base64 || !photo.uri) {
        setStatus('Capture failed — no image data');
        setProcessing(false);
        return;
      }

      setStatus('Detecting...');

      // downscale using native image manipulator first — much faster than JS decode on full-res
      const small = await manipulateAsync(
        photo.uri,
        [{ resize: { width: DETECTION_DOWNSCALE } }],
        { format: SaveFormat.JPEG, compress: 0.8, base64: true }
      );

      if (!small.base64) {
        setStatus('Downscale failed');
        setProcessing(false);
        return;
      }

      const decoded = decodeJpegFromBase64(small.base64);
      const result: DetectionResult = detectMarker1(decoded);

      if (!result.ok) {
        setStatus(`Rejected: ${result.reason}`);
        setProcessing(false);
        return;
      }

      setStatus('Extracting marker...');

      // map bbox from downscaled coords back to original image coords
      const scaleX = photo.width / decoded.width;
      const scaleY = photo.height / decoded.height;

      const cropX = Math.max(0, Math.round(result.bbox.x * scaleX));
      const cropY = Math.max(0, Math.round(result.bbox.y * scaleY));
      const cropW = Math.min(
        Math.round(result.bbox.width * scaleX),
        photo.width - cropX
      );
      const cropH = Math.min(
        Math.round(result.bbox.height * scaleY),
        photo.height - cropY
      );

      const rotation = rotationForAnchor(result.anchor);

      const extracted = await manipulateAsync(
        photo.uri,
        [
          { crop: { originX: cropX, originY: cropY, width: cropW, height: cropH } },
          ...(rotation !== 0 ? [{ rotate: rotation }] : []),
          { resize: { width: OUTPUT_SIZE, height: OUTPUT_SIZE } },
        ],
        { format: SaveFormat.JPEG, compress: 0.9 }
      );

      const marker: ProcessedMarker = {
        id: `m-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        uri: extracted.uri,
        anchor: result.anchor,
        timestamp: Date.now(),
        confidence: result.confidence,
      };

      setMarkers(prev => {
        const next = [...prev, marker];
        if (next.length >= REQUIRED_MARKERS) {
          setStatus(`Done — ${REQUIRED_MARKERS} markers collected`);
        } else {
          setStatus(`Detected! (${next.length}/${REQUIRED_MARKERS})`);
        }
        return next;
      });
    } catch (e: any) {
      setStatus(`Error: ${e.message ?? 'unknown'}`);
      if (__DEV__) console.warn('captureAndDetect error:', e);
    } finally {
      setProcessing(false);
    }
  }, [processing, markers.length]);

  const reset = useCallback(() => {
    setMarkers([]);
    setStatus('Ready — tap Capture to detect');
  }, []);

  // permission states
  if (!permission) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#fff" />
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

  // results screen
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
              <Text style={styles.markerLabel}>
                #{i + 1} — {m.anchor} — {(m.confidence * 100).toFixed(0)}%
              </Text>
            </View>
          ))}
        </ScrollView>
      </SafeAreaView>
    );
  }

  // scanner screen
  return (
    <View style={styles.root}>
      <CameraView
        ref={cameraRef}
        style={styles.camera}
        facing="back"
        onCameraReady={handleCameraReady}
      >
        <View style={styles.overlay}>
          <View style={styles.guideBox} />
          <Text style={styles.guideText}>
            Align marker inside the box
          </Text>
        </View>
      </CameraView>

      <SafeAreaView style={styles.controls}>
        <Text style={styles.status}>{status}</Text>
        <Text style={styles.count}>
          {markers.length} / {REQUIRED_MARKERS}
        </Text>

        <View style={styles.btnRow}>
          <TouchableOpacity
            style={[styles.btn, styles.btnPrimary, processing && styles.btnDisabled]}
            onPress={captureAndDetect}
            disabled={processing || markers.length >= REQUIRED_MARKERS}
          >
            <Text style={styles.btnText}>
              {processing ? 'Processing...' : 'Capture'}
            </Text>
          </TouchableOpacity>

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
    borderColor: 'rgba(255,255,255,0.5)',
    borderRadius: 4,
  },
  guideText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 13,
    marginTop: 12,
  },
  controls: {
    backgroundColor: '#111',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 24,
  },
  status: {
    color: '#aaa',
    fontSize: 13,
    textAlign: 'center',
    fontFamily: 'monospace',
  },
  count: {
    color: '#fff',
    fontSize: 28,
    fontWeight: '700',
    textAlign: 'center',
    marginVertical: 6,
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
  btnDisabled: {
    opacity: 0.5,
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
    fontFamily: 'monospace',
  },
});
