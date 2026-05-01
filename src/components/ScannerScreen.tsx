import { useRef, useState, useCallback, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ScrollView,
  Image,
  ActivityIndicator,
  Platform,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import * as Haptics from 'expo-haptics';
import {
  REQUIRED_MARKERS,
  OUTPUT_SIZE,
  DETECTION_DOWNSCALE,
  CAPTURE_QUALITY,
  SCAN_INTERVAL_MS,
} from '../constants/scanner';
import { decodeJpegFromBase64 } from '../utils/image/decodeJpeg';
import { detectMarker1 } from '../utils/marker/detectMarker1';
import { rotationForAnchor } from '../utils/marker/orientation';
import type { ProcessedMarker } from '../types/marker';

type Screen = 'scanner' | 'results';

const { width: SCREEN_W } = Dimensions.get('window');
const GRID_COLS = 2;
const GRID_GAP = 10;
const GRID_CARD_W = Math.floor((SCREEN_W - 32 - GRID_GAP * (GRID_COLS - 1)) / GRID_COLS);

export function ScannerScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [screen, setScreen] = useState<Screen>('scanner');
  const [markers, setMarkers] = useState<ProcessedMarker[]>([]);
  const [status, setStatus] = useState('Point camera at a marker');
  const [debugInfo, setDebugInfo] = useState('');
  const [processing, setProcessing] = useState(false);
  const [autoScan, setAutoScan] = useState(false);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);
  const cameraRef = useRef<CameraView>(null);
  const cameraReady = useRef(false);
  const processingRef = useRef(false);
  const markersRef = useRef<ProcessedMarker[]>([]);
  const scanStartRef = useRef<number | null>(null);

  const handleCameraReady = useCallback(() => {
    cameraReady.current = true;
  }, []);

  useEffect(() => { markersRef.current = markers; }, [markers]);

  useEffect(() => {
    if (!autoScan) return;
    const id = setInterval(() => {
      if (!processingRef.current && markersRef.current.length < REQUIRED_MARKERS) {
        captureAndDetect();
      }
    }, SCAN_INTERVAL_MS);
    return () => clearInterval(id);
  }, [autoScan]);

  const toggleAutoScan = useCallback(() => {
    setAutoScan(prev => {
      if (!prev) {
        // starting scan
        scanStartRef.current = Date.now();
        setElapsedMs(null);
      }
      return !prev;
    });
  }, []);

  const captureAndDetect = useCallback(async () => {
    if (!cameraReady.current || !cameraRef.current || processingRef.current) return;
    if (markersRef.current.length >= REQUIRED_MARKERS) {
      setAutoScan(false);
      setStatus('All markers collected');
      return;
    }

    processingRef.current = true;
    setProcessing(true);
    setStatus('Capturing...');
    setDebugInfo('');

    try {
      const photo = await cameraRef.current.takePictureAsync({
        base64: true,
        quality: CAPTURE_QUALITY,
        shutterSound: false,
      });

      if (!photo?.base64 || !photo.uri) {
        setStatus('Capture failed');
        processingRef.current = false;
        setProcessing(false);
        return;
      }

      // enforce 2000-3000px resolution constraint for detection source
      const maxFeedRes = 3000;
      const photoMax = Math.max(photo.width, photo.height);
      let feedUri = photo.uri;
      let feedW = photo.width;
      let feedH = photo.height;

      if (photoMax > maxFeedRes) {
        const scaled = await manipulateAsync(
          photo.uri,
          [{ resize: { width: Math.min(photo.width, maxFeedRes) } }],
          { format: SaveFormat.JPEG, compress: 0.9 }
        );
        feedUri = scaled.uri;
        feedW = scaled.width;
        feedH = scaled.height;
      }

      setStatus('Detecting...');
      setDebugInfo(`feed: ${feedW}x${feedH} (src: ${photo.width}x${photo.height})`);

      const small = await manipulateAsync(
        feedUri,
        [{ resize: { width: DETECTION_DOWNSCALE } }],
        { format: SaveFormat.JPEG, compress: 0.8, base64: true }
      );

      if (!small.base64) {
        setStatus('Downscale failed');
        processingRef.current = false;
        setProcessing(false);
        return;
      }

      const decoded = decodeJpegFromBase64(small.base64);
      const result = detectMarker1(decoded);

      if (result.stats) {
        const s = result.stats;
        const line1 = `${s.imgSize} mean=${s.mean} thr=${s.threshold} blk=${s.blackPct}%`;
        let line2 = `${s.totalCandidates} candidates`;
        if (s.candidateFound) {
          line2 += ` | HIT L${s.hitLevel} t=${s.hitThreshold}`;
        } else if (s.candidateBox) {
          line2 += ` | ${s.candidateBox} r=${s.squareRatio}`;
          if (s.rejectReason) line2 += `\n${s.rejectReason}`;
        }
        if (s.brightRegion) line2 += `\n${s.brightRegion}`;
        setDebugInfo(`${line1}\n${line2}`);
      }

      if (!result.ok) {
        setStatus(autoScan ? 'Scanning...' : `Not found: ${result.reason}`);
        processingRef.current = false;
        setProcessing(false);
        return;
      }

      setStatus('Extracting...');

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

      const tilt = result.tiltDegrees ?? 0;
      const anchorRot = rotationForAnchor(result.anchor);

      let extracted;
      if (tilt !== 0) {
        const step1 = await manipulateAsync(
          photo.uri,
          [
            { crop: { originX: cropX, originY: cropY, width: cropW, height: cropH } },
            { rotate: tilt },
          ],
          { format: SaveFormat.JPEG, compress: 0.9 }
        );

        const centerSize = Math.round(Math.min(step1.width, step1.height) * 0.55);
        const centerX = Math.round((step1.width - centerSize) / 2);
        const centerY = Math.round((step1.height - centerSize) / 2);

        extracted = await manipulateAsync(
          step1.uri,
          [
            { crop: { originX: centerX, originY: centerY, width: centerSize, height: centerSize } },
            ...(anchorRot !== 0 ? [{ rotate: anchorRot }] : []),
            { resize: { width: OUTPUT_SIZE, height: OUTPUT_SIZE } },
          ],
          { format: SaveFormat.JPEG, compress: 0.9 }
        );
      } else {
        extracted = await manipulateAsync(
          photo.uri,
          [
            { crop: { originX: cropX, originY: cropY, width: cropW, height: cropH } },
            ...(anchorRot !== 0 ? [{ rotate: anchorRot }] : []),
            { resize: { width: OUTPUT_SIZE, height: OUTPUT_SIZE } },
          ],
          { format: SaveFormat.JPEG, compress: 0.9 }
        );
      }

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
          setAutoScan(false);
          const totalMs = scanStartRef.current ? Date.now() - scanStartRef.current : null;
          setElapsedMs(totalMs);
          setStatus(`All markers collected${totalMs ? ` in ${(totalMs / 1000).toFixed(1)}s` : ''}`);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } else {
          setStatus(`Detected (${next.length}/${REQUIRED_MARKERS})`);
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }
        return next;
      });
    } catch (e: any) {
      setStatus(`Error: ${e.message ?? 'unknown'}`);
      if (__DEV__) console.warn('captureAndDetect error:', e);
    } finally {
      processingRef.current = false;
      setProcessing(false);
    }
  }, []);

  const reset = useCallback(() => {
    setAutoScan(false);
    setMarkers([]);
    setStatus('Point camera at a marker');
    setDebugInfo('');
    setElapsedMs(null);
    scanStartRef.current = null;
  }, []);

  // --- Permission states ---
  if (!permission) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#60a5fa" size="large" />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Ionicons name="camera-outline" size={48} color="#555" style={{ marginBottom: 16 }} />
        <Text style={styles.permTitle}>Camera Access Required</Text>
        <Text style={styles.permDesc}>
          markerflow needs camera access to detect and extract markers from your environment.
        </Text>
        <TouchableOpacity style={styles.permBtn} onPress={requestPermission} activeOpacity={0.7}>
          <Text style={styles.permBtnText}>Allow Camera</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // --- Results screen ---
  if (screen === 'results') {
    return (
      <View style={styles.root}>
        <View style={styles.resultsHeader}>
          <TouchableOpacity
            onPress={() => setScreen('scanner')}
            style={styles.backBtn}
            activeOpacity={0.7}
          >
            <Ionicons name="arrow-back" size={20} color="#60a5fa" />
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>
            {markers.length} Marker{markers.length !== 1 ? 's' : ''} Detected
          </Text>
          {elapsedMs != null && (
            <Text style={styles.elapsedText}>
              {(elapsedMs / 1000).toFixed(1)}s total
            </Text>
          )}
        </View>

        <ScrollView contentContainerStyle={styles.grid}>
          {markers.map((m, i) => (
            <View key={m.id} style={styles.gridCard}>
              <Image
                source={{ uri: m.uri }}
                style={styles.gridImage}
                resizeMode="cover"
              />
              <View style={styles.gridCardFooter}>
                <Text style={styles.gridIndex}>#{i + 1}</Text>
                <Text style={styles.gridConf}>{(m.confidence * 100).toFixed(0)}%</Text>
              </View>
            </View>
          ))}
        </ScrollView>
      </View>
    );
  }

  // --- Scanner screen ---
  const progress = markers.length / REQUIRED_MARKERS;
  const done = markers.length >= REQUIRED_MARKERS;

  return (
    <View style={styles.root}>
      <CameraView
        ref={cameraRef}
        style={styles.camera}
        facing="back"
        onCameraReady={handleCameraReady}
      >
        {/* Guide overlay */}
        <View style={styles.overlay}>
          <View style={styles.overlayTop} />
          <View style={styles.overlayMiddle}>
            <View style={styles.overlaySide} />
            <View style={[styles.guideBox, autoScan && styles.guideBoxActive]}>
              {/* Corner accents */}
              <View style={[styles.corner, styles.cornerTL, autoScan && styles.cornerActive]} />
              <View style={[styles.corner, styles.cornerTR, autoScan && styles.cornerActive]} />
              <View style={[styles.corner, styles.cornerBL, autoScan && styles.cornerActive]} />
              <View style={[styles.corner, styles.cornerBR, autoScan && styles.cornerActive]} />
            </View>
            <View style={styles.overlaySide} />
          </View>
          <View style={styles.overlayBottom}>
            <Text style={styles.guideText}>
              {done ? 'Done' : autoScan ? 'Scanning...' : 'Align marker in frame'}
            </Text>
          </View>
        </View>
      </CameraView>

      {/* Controls panel */}
      <View style={styles.controls}>
        {/* Progress bar */}
        <View style={styles.progressRow}>
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
          </View>
          <Text style={styles.progressText}>{markers.length}/{REQUIRED_MARKERS}</Text>
        </View>

        {/* Status */}
        <Text style={styles.status} numberOfLines={1}>{status}</Text>
        {debugInfo !== '' && <Text style={styles.debug} numberOfLines={3}>{debugInfo}</Text>}

        {/* Action buttons */}
        <View style={styles.btnRow}>
          <TouchableOpacity
            style={[styles.actionBtn, autoScan ? styles.btnStop : styles.btnStart, done && styles.btnDisabled]}
            onPress={toggleAutoScan}
            disabled={done}
            activeOpacity={0.7}
          >
            <Ionicons
              name={autoScan ? 'stop' : 'play'}
              size={18}
              color="#fff"
            />
            <Text style={styles.actionBtnText}>
              {autoScan ? 'Stop' : 'Start'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionBtn, styles.btnSecondary, (processing || done) && styles.btnDisabled]}
            onPress={captureAndDetect}
            disabled={processing || done}
            activeOpacity={0.7}
          >
            <Ionicons name="camera" size={18} color="#fff" />
            <Text style={styles.actionBtnText}>1x</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionBtn, styles.btnSecondary]}
            onPress={reset}
            activeOpacity={0.7}
          >
            <Ionicons name="refresh" size={18} color="#fff" />
          </TouchableOpacity>

          {markers.length > 0 && (
            <TouchableOpacity
              style={[styles.actionBtn, styles.btnResults]}
              onPress={() => setScreen('results')}
              activeOpacity={0.7}
            >
              <Ionicons name="grid" size={18} color="#fff" />
              <Text style={styles.actionBtnText}>View</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  center: {
    flex: 1,
    backgroundColor: '#0a0a0a',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  camera: {
    flex: 1,
  },

  // --- Permission ---
  permTitle: {
    color: '#f0f0f0',
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 8,
  },
  permDesc: {
    color: '#888',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },
  permBtn: {
    backgroundColor: '#2563eb',
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 10,
  },
  permBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },

  // --- Guide Overlay ---
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
  },
  overlayTop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  overlayMiddle: {
    flexDirection: 'row',
  },
  overlaySide: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  overlayBottom: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    paddingTop: 20,
  },
  guideBox: {
    width: 240,
    height: 240,
    position: 'relative',
  },
  guideBoxActive: {
    // active state handled by corner color
  },
  corner: {
    position: 'absolute',
    width: 28,
    height: 28,
    borderColor: 'rgba(255,255,255,0.7)',
  },
  cornerActive: {
    borderColor: '#22c55e',
  },
  cornerTL: {
    top: 0,
    left: 0,
    borderTopWidth: 3,
    borderLeftWidth: 3,
    borderTopLeftRadius: 4,
  },
  cornerTR: {
    top: 0,
    right: 0,
    borderTopWidth: 3,
    borderRightWidth: 3,
    borderTopRightRadius: 4,
  },
  cornerBL: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 3,
    borderLeftWidth: 3,
    borderBottomLeftRadius: 4,
  },
  cornerBR: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 3,
    borderRightWidth: 3,
    borderBottomRightRadius: 4,
  },
  guideText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 13,
    fontWeight: '500',
    letterSpacing: 0.3,
  },

  // --- Controls ---
  controls: {
    backgroundColor: '#0f0f0f',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'android' ? 8 : 20,
    gap: 8,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  progressBar: {
    flex: 1,
    height: 4,
    backgroundColor: '#1f1f1f',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#22c55e',
    borderRadius: 2,
  },
  progressText: {
    color: '#888',
    fontSize: 12,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    minWidth: 36,
    textAlign: 'right',
  },
  status: {
    color: '#ccc',
    fontSize: 12,
    fontFamily: 'monospace',
  },
  debug: {
    color: '#555',
    fontSize: 10,
    fontFamily: 'monospace',
    lineHeight: 14,
  },
  btnRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
  },
  actionBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  btnStart: {
    backgroundColor: '#2563eb',
  },
  btnStop: {
    backgroundColor: '#dc2626',
  },
  btnSecondary: {
    backgroundColor: '#262626',
  },
  btnResults: {
    backgroundColor: '#7c3aed',
    marginLeft: 'auto',
  },
  btnDisabled: {
    opacity: 0.4,
  },

  // --- Results screen ---
  resultsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'android' ? 48 : 56,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#1f1f1f',
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingRight: 8,
  },
  backText: {
    color: '#60a5fa',
    fontSize: 14,
    fontWeight: '500',
  },
  headerTitle: {
    color: '#f0f0f0',
    fontSize: 16,
    fontWeight: '700',
  },
  elapsedText: {
    color: '#4ade80',
    fontSize: 13,
    fontWeight: '600',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: 16,
    gap: GRID_GAP,
    paddingBottom: 40,
  },
  gridCard: {
    width: GRID_CARD_W,
    backgroundColor: '#141414',
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#1f1f1f',
  },
  gridImage: {
    width: '100%',
    aspectRatio: 1,
  },
  gridCardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  gridIndex: {
    color: '#888',
    fontSize: 11,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  gridConf: {
    color: '#22c55e',
    fontSize: 11,
    fontWeight: '600',
  },
});
