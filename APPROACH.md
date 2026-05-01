# MarkerFlow — Approach Document

## Alemeno Frontend Internship Assignment
**Candidate:** Harpalsinh  
**Project:** Custom Marker Detection & Extraction (Android/React Native)  
**Repository:** https://github.com/harpalll/markerflow  
**APK:** https://expo.dev/accounts/harpalsinh/projects/markerflow/builds/1fabf0de-d0f6-4a98-8541-d9e4e105ce70

---

## 1. Problem Summary

Build a React Native Android app that:
- Accesses the device camera and renders a live feed (2000-3000px)
- Detects a specific custom marker (Marker 1) in the frame
- Isolates, extracts, and orientation-corrects it
- Displays 20 processed markers from 20 different frames at 300x300px

---

## 2. Marker Choice

I chose **Marker 1** from the provided zip — a thick black square border with a small black square anchor in one corner. This structure provides:
- Clear geometric signature (square border) for candidate detection
- Unambiguous orientation via single corner anchor
- High contrast (black on white) for reliable thresholding

---

## 3. Architecture Decision: Pure JavaScript Pipeline

**Why not OpenCV/native modules?**

The assignment requires Expo managed workflow compatibility. Native OpenCV bindings (react-native-opencv) require dev builds and native linking, breaking Expo Go compatibility. Instead, I implemented the entire detection pipeline in TypeScript using:

- `expo-image-manipulator` — hardware-accelerated resize/crop/rotate
- `jpeg-js` — pure JS JPEG decoding to raw pixel arrays
- Custom algorithms — thresholding, flood-fill, connected components, validation

This gives ~500-800ms per detection cycle, well within the 3000ms target.

---

## 4. Detection Pipeline (6 Stages)

### Stage 1: Capture & Resolution Enforcement

Camera captures at native resolution (typically 4032x3024 on modern phones). If the image exceeds 3000px, it's downscaled to 3000px maximum. This ensures the "live feed" constraint (2000-3000px) is met. The full-resolution source is preserved separately for high-quality extraction.

### Stage 2: Adaptive Thresholding (Otsu's Method)

Rather than a fixed black/white threshold (which fails under varying lighting), I compute the optimal threshold dynamically using Otsu's method:

1. Build a 256-bin grayscale histogram of the downscaled image
2. For each possible threshold (0-255), compute inter-class variance
3. Select the threshold that maximizes separation between "dark" and "light" pixel populations

This adapts to:
- Marker displayed on a laptop screen (white appears as gray ~85-100)
- Printed marker under warm/cool lighting
- Varying camera exposure

### Stage 3: Grid-Based Candidate Detection

Scanning every pixel for connected components at 500px is expensive. Instead:

1. **Coarse grid scan** (3px stride) — find unvisited black pixels
2. **8-connectivity flood fill** — trace the entire connected region
3. **Bounding box computation** — get the extent of the region
4. **Size filter** — reject regions smaller than 15% of image dimension
5. **Squareness filter** — aspect ratio must be 0.8 to 1.2

Multiple threshold levels (computed threshold ±10, ±20) are attempted. This handles cases where the computed threshold is slightly off.

### Stage 4: Border Density Validation

For each candidate bounding box, verify it has thick black borders:

- Divide each edge into a band (11.7% of the marker side width)
- Compute black pixel density in each of the 4 bands (top, bottom, left, right)
- All 4 bands must have ≥42% black density

This eliminates most false positives — random dark objects rarely have uniform thick borders on all sides.

### Stage 5: Connected Component Anchor Validation

This is the critical stage that differentiates Marker 1 from visually similar shapes:

1. **Exclude border region** (14% from each edge) to analyze only the interior
2. **Flood-fill all black components** inside the interior
3. **Classify each component:**
   - **Oversized corner block** (>21.7% of side) → immediate rejection
   - **Center block** (in center 35-65% zone with >12% density) → rejection
   - **Large inner block** (in 25-75% zone, too large) → rejection
4. **Search for valid anchor:**
   - Must be in a corner zone (11.7% to 31.7% from edge)
   - Side length: 8.3% to 19.3% of marker side
   - Roughly square (aspect 0.75 to 1.25)
   - Area: 0.8% to 4.5% of total marker area
5. **Relaxed fallback** — for camera blur, allows slightly smaller anchors (0.6× minimum)

**Why this works:** Marker 1 has exactly one small square in a corner. Incorrect markers (Marker 2, squares with center patterns, squares with multiple corner elements) all fail these constraints.

### Stage 6: Orientation Correction & Extraction

The anchor's corner position determines rotation:

| Anchor Position | Rotation Applied |
|----------------|-----------------|
| Top-Left | 0° (canonical) |
| Top-Right | 270° CCW |
| Bottom-Right | 180° |
| Bottom-Left | 90° CW |

For tilted markers (diamond orientation at ~45°):
1. Rotate the crop by the detected tilt angle
2. Extract the central 55% (removes corner artifacts)
3. Apply anchor-based rotation correction
4. Resize to exactly 300×300px

---

## 5. Handling the Evaluation Criteria

### Speed (target: <3000ms per scan)
- Detection runs on 500px downscaled image (~250,000 pixels vs 9+ million)
- Grid sampling avoids scanning every pixel
- Auto-scan at 600ms intervals; each detection cycle takes 500-800ms
- Total time for 20 markers displayed in results header

### Orientation Robustness
- Anchor-based rotation handles 0°, 90°, 180°, 270° reliably
- Tilted/diamond markers handled via rotation fallback with bilinear interpolation
- Bilinear interpolation (vs nearest-neighbor) prevents staircase artifacts that would break border density checks

### Extraction Accuracy
- Coordinates mapped from 500px detection space back to original resolution for cropping
- Tight bounding box from flood-fill (no padding)
- Orientation correction before final resize
- Output is exactly 300×300px

### Detection Accuracy
- **True positives:** All provided correct marker images detected successfully
- **True negatives:** All provided incorrect marker images rejected
- Connected component analysis is the key — density-only checks would miss subtle differences

---

## 6. Tech Stack Justification

| Choice | Reason |
|--------|--------|
| Expo SDK 54 (managed) | No native build complexity, works in Expo Go for dev |
| jpeg-js | Pure JS decode, no native dependency needed |
| expo-image-manipulator | Hardware-accelerated crop/resize/rotate via native APIs |
| expo-haptics | Tactile feedback improves UX during scanning |
| TypeScript | Type safety for complex pixel manipulation code |
| EAS Build | Cloud-built APK without local Android SDK setup |

---

## 7. Limitations & Future Improvements

| Limitation | Potential Fix |
|-----------|--------------|
| No perspective correction (skewed markers from steep angles) | Implement 4-point homography transform |
| JS processing is single-threaded | Use react-native-worklets or native module for parallel processing |
| Camera captures as JPEG (lossy) | Use RAW capture for higher contrast fidelity |
| Fixed 600ms scan interval | Adaptive interval based on processing time |

---

## 8. Testing

### Synthetic Tests (built into app)
10 programmatic test cases run in the "Tests" tab:
- 4 valid orientations (anchor in each corner)
- 6 rejection patterns (no anchor, center block, oversized corner, off-center block, multiple corners, full interior)

All 10 pass at 300px, 150px, and 100px resolutions.

### Device Tests
- All provided correct marker images: **detected successfully**
- All provided incorrect marker images: **rejected correctly**
- Tested with marker displayed on laptop screen and printed on paper
- Tested under different lighting conditions

---

## 9. Summary

The core insight of this solution is that **structural validation via connected component analysis** is far more robust than simple density checks. By flood-filling interior black regions and validating their size, position, and shape, the system reliably distinguishes Marker 1 from visually similar squares — even under challenging conditions like screen photography and varying ambient light.
