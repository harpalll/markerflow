# MarkerFlow

Android native app for custom marker detection and extraction, built with React Native (Expo).

Detects a specific visual marker (Marker 1) from a live camera feed, extracts it with orientation correction, and displays 20 processed markers at 300x300px.

---

## Download APK

[**Download Installable APK**](https://expo.dev/accounts/harpalsinh/projects/markerflow/builds/1fabf0de-d0f6-4a98-8541-d9e4e105ce70)

---

## Quick Start

### Prerequisites

- Node.js 18+
- npm or yarn
- Expo CLI (`npm install -g expo-cli`)
- Android device with Expo Go installed (for development)
- EAS CLI for APK builds (`npm install -g eas-cli`)

### Install & Run

```bash
git clone https://github.com/harpalll/markerflow.git
cd markerflow
npm install
npx expo start
```

Scan the QR code with Expo Go on your Android device.

### Build APK

```bash
npx eas build -p android --profile preview
```

This produces an installable `.apk` file.

---

## How It Works

### Detection Pipeline

The app uses a pure-JavaScript image processing pipeline (no native OpenCV dependency) to detect and validate the marker:

```
Camera Capture (2000-3000px)
         |
         v
+------------------+
| Downscale to     |
| 500px (fast JS)  |
+------------------+
         |
         v
+------------------+
| Adaptive         |
| Thresholding     |
| (Otsu-based)     |
+------------------+
         |
         v
+------------------+
| Grid-based       |
| Candidate Scan   |
| (8-connectivity  |
|  flood fill)     |
+------------------+
         |
         v
+------------------+
| Structural       |
| Validation       |
| (border density, |
|  squareness)     |
+------------------+
         |
         v
+------------------+
| Connected        |
| Component Anchor |
| Validation       |
+------------------+
         |
         v
+------------------+
| Orientation      |
| Correction       |
| (anchor-based    |
|  rotation)       |
+------------------+
         |
         v
+------------------+
| Crop & Resize    |
| to 300x300px     |
+------------------+
```

### Stage Details

#### 1. Capture & Resolution Enforcement

The camera captures at native resolution. If the image exceeds 3000px on any axis, it's downscaled to 3000px before detection processing. This enforces the 2000-3000px feed constraint while preserving extraction quality from the full-resolution source.

#### 2. Adaptive Thresholding

Uses Otsu's method to compute an optimal black/white threshold based on the image histogram. This adapts to varying lighting conditions (screen display, printed paper, different ambient light).

```
Input: Grayscale pixel values (0-255)
Output: Binary classification (black < threshold, white >= threshold)
Method: Minimize intra-class variance across all possible thresholds
```

#### 3. Grid-Based Candidate Detection

Instead of scanning every pixel, samples the image on a grid (every 3px at coarse level, every 1px at fine level). When a black pixel is found that hasn't been visited, flood-fill (8-connectivity) traces the entire connected component.

```
Grid sampling (3px stride)
         |
    Find black pixel
         |
    8-connectivity flood fill
         |
    Compute bounding box
         |
    Filter: size > 15% of image
    Filter: squareness ratio 0.8-1.2
         |
    Candidate found
```

#### 4. Structural Validation — Border Check

Validates that the candidate has thick black borders on all 4 sides:

```
+---+---+---+---+---+
|   | T |   | T |   |   T = Top border band
+---+---+---+---+---+
| L |               | R |   L/R = Left/Right bands
+---+               +---+
|   |    INTERIOR   |   |   Border band = 11.7% of side
+---+               +---+
| L |               | R |
+---+---+---+---+---+
|   | B |   | B |   |   B = Bottom border band
+---+---+---+---+---+

Each band must have >= 42% black pixel density
```

#### 5. Connected Component Anchor Validation

This is the key differentiation from false positives. After confirming the border structure, the interior is analyzed using connected component analysis:

```
Interior region (excluding 14% border exclusion zone)
         |
    Flood-fill all black components
         |
    For each component:
      - Compute bounding box, area, aspect ratio
      - Classify position (corner vs center vs inner)
         |
    Rejection rules:
      - Center density > 12% -> reject (not Marker 1)
      - Oversized corner block (>21.7% of side) -> reject
      - Large non-corner inner block -> reject
      - Inner density > 18% -> reject
         |
    Anchor search:
      - Must be in corner zone (11.7% to 31.7% from edge)
      - Side length: 8.3% to 19.3% of marker side
      - Aspect ratio: 0.75 to 1.25 (roughly square)
      - Area ratio: 0.8% to 4.5% of marker area
         |
    Valid anchor found -> PASS
    No valid anchor -> REJECT
```

Corner zone positions:

```
+------+------+------+
| TL   |      | TR   |   Anchor must be in ONE of
| zone |      | zone |   these 4 corner zones
+------+      +------+
|                     |
+------+      +------+
| BL   |      | BR   |
| zone |      | zone |
+------+------+------+
```

#### 6. Orientation Correction

The anchor position determines the marker's rotation. Marker 1's anchor is in the top-left corner in the canonical orientation:

```
Anchor position -> Rotation needed:
  Top-Left     -> 0 degrees (correct orientation)
  Top-Right    -> 270 degrees (rotate CCW)
  Bottom-Right -> 180 degrees
  Bottom-Left  -> 90 degrees (rotate CW)
```

#### 7. Tilted/Diamond Marker Handling

For markers photographed at 45-degree angles (diamond shape), a rotation fallback is attempted:

```
Candidate fails normal validation
         |
    Try rotated validation:
      - Rotate image by 45 degrees (bilinear interpolation)
      - Re-run candidate detection on rotated image
      - If passes validation -> return with tiltDegrees
         |
    Extraction applies tilt correction + anchor rotation
```

#### 8. Extraction & Resize

Coordinates are mapped from 500px detection space back to original photo resolution. The marker is cropped, orientation-corrected, and resized to exactly 300x300px.

---

## Project Structure

```
markerflow/
├── App.tsx                          # Tab navigation (Scanner / Tests)
├── app.json                         # Expo config
├── index.ts                         # Entry point
├── src/
│   ├── constants/
│   │   └── scanner.ts               # All detection thresholds
│   ├── types/
│   │   └── marker.ts                # TypeScript interfaces
│   ├── utils/
│   │   ├── image/
│   │   │   ├── decodeJpeg.ts        # Base64 -> RGBA pixel data
│   │   │   └── pixelUtils.ts        # Grayscale, density, Otsu, crop, rotate
│   │   └── marker/
│   │       ├── detectMarker1.ts     # Main detection pipeline
│   │       ├── validateMarker1.ts   # Connected component anchor validation
│   │       ├── orientation.ts       # Anchor position -> rotation degrees
│   │       └── fixtures.ts          # Synthetic test image generators
│   └── components/
│       ├── ScannerScreen.tsx        # Camera + auto-scan + results grid
│       └── TestHarness.tsx          # 10 synthetic detection tests
└── assets/                          # Icons, splash screen
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | React Native (Expo SDK 54, managed workflow) |
| Camera | expo-camera v17 (CameraView API) |
| Image processing | expo-image-manipulator + jpeg-js (pure JS decode) |
| Haptics | expo-haptics (feedback on detection) |
| Icons | @expo/vector-icons (Ionicons) |
| Language | TypeScript 5.9 |
| Build | EAS Build (APK via preview profile) |

---

## Detection Accuracy

### What gets detected (correct markers):
- Marker 1 in any rotation (0, 90, 180, 270 degrees)
- Marker 1 at ~45 degree tilt (diamond orientation)
- Marker 1 on screen or printed paper
- Varying lighting conditions (adaptive threshold)

### What gets rejected (false positives):
- Squares without the corner anchor
- Squares with centered internal patterns
- Squares with oversized internal blocks
- Squares with content filling >18% of interior
- Random dark shapes that pass squareness check
- Marker 2 (different internal structure)

---

## Performance

| Metric | Target | Achieved |
|--------|--------|----------|
| Single scan-to-result | < 3000ms | ~500-800ms per frame |
| 20 markers total time | - | Displayed after completion |
| Auto-scan interval | - | 600ms between captures |
| Detection resolution | 2000-3000px feed | Enforced via downscale |
| Output size | 300x300px | Exact |

---

## Configuration

Key parameters in `src/constants/scanner.ts`:

| Constant | Value | Purpose |
|----------|-------|---------|
| `SCAN_INTERVAL_MS` | 600 | Auto-scan capture interval |
| `DETECTION_DOWNSCALE` | 500 | Detection runs at this resolution |
| `REQUIRED_MARKERS` | 20 | Markers to collect before done |
| `OUTPUT_SIZE` | 300 | Final extracted marker size (px) |
| `MIN_BORDER_DENSITY` | 0.42 | Minimum black in border bands |
| `MAX_CENTER_DENSITY` | 0.12 | Maximum black in center region |
| `MAX_INNER_DENSITY` | 0.18 | Maximum black in interior |

---

## Building

### Development (Expo Go)

```bash
npx expo start
```

### Production APK

```bash
# Install EAS CLI
npm install -g eas-cli

# Login to Expo account
eas login

# Build APK
npx eas build -p android --profile preview
```

The APK will be available for download from the EAS dashboard.

---

## License

MIT
