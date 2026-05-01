import type { ImageData, BBox, DetectionResult } from '../../types/marker';
import {
  grayAt,
  imageStats,
  computeAdaptiveThreshold,
  regionDensity,
  findBrightRegion,
  cropImageData,
  rotateImageData,
} from '../image/pixelUtils';
import { validateMarker1 } from './validateMarker1';
import {
  MIN_SQUARE_RATIO,
  MAX_SQUARE_RATIO,
} from '../../constants/scanner';

export interface DetectionStats {
  imgSize: string;
  mean: number;
  threshold: number;
  blackPct: number;
  candidateFound: boolean;
  candidateBox?: string;
  squareRatio?: number;
  totalCandidates: number;
  hitLevel?: number;
  hitThreshold?: number;
  rejectReason?: string;
  brightRegion?: string;
}

// cell density thresholds — run grid analysis at each level
const CELL_THRESHOLDS = [0.30, 0.45, 0.60];

/**
 * Detect Marker 1 in the image.
 * Tries multiple pixel thresholds to handle dim screen captures where
 * the "white" background photographs as gray 80-120 instead of 200+.
 * Falls back to bright-region isolation when the frame is dark-dominated.
 */
export function detectMarker1(
  img: ImageData,
  thresholdOverride?: number
): DetectionResult & { stats: DetectionStats } {
  const result = runDetection(img, thresholdOverride);

  // if first pass failed and most of the image is dark, try isolating
  // the bright region (screen surface, paper) and re-detecting within it
  if (!result.ok && result.stats.blackPct > 45) {
    const brightThresh = Math.max(result.stats.mean + 20, 110);
    const region = findBrightRegion(img, brightThresh);
    if (region) {
      const cropped = cropImageData(img, region);
      const subResult = runDetection(cropped);

      if (subResult.ok) {
        return {
          ok: true,
          bbox: {
            x: subResult.bbox.x + region.x,
            y: subResult.bbox.y + region.y,
            width: subResult.bbox.width,
            height: subResult.bbox.height,
          },
          anchor: subResult.anchor,
          confidence: subResult.confidence,
          debug: subResult.debug,
          stats: {
            ...subResult.stats,
            brightRegion: `${region.width}x${region.height}@(${region.x},${region.y})`,
          },
        };
      }

      result.stats.brightRegion = `${region.width}x${region.height} no_hit`;
      if (subResult.stats.rejectReason) {
        result.stats.rejectReason = `bright: ${subResult.stats.rejectReason}`;
      }
    }
  }

  return result;
}

/**
 * Core detection pipeline — runs multi-threshold grid search and validation.
 */
function runDetection(
  img: ImageData,
  thresholdOverride?: number
): DetectionResult & { stats: DetectionStats } {
  const stats = imageStats(img);
  const otsu = thresholdOverride ?? computeAdaptiveThreshold(img);

  // When the screen's white photographs as gray ~85-100, Otsu overshoots.
  // Lower thresholds (fractions of mean) isolate only the true blacks
  // (marker border at gray ~20-40) from the dim white.
  const pixelThresholds = thresholdOverride
    ? [thresholdOverride]
    : dedupeThresholds([
        Math.round(stats.mean * 0.55),
        Math.round(stats.mean * 0.75),
        otsu,
      ]);

  const { width, height } = img;
  const step = Math.max(1, Math.floor(Math.min(width, height) / 200));
  let blackCount = 0;
  let sampleCount = 0;
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      if (grayAt(img, x, y) < otsu) blackCount++;
      sampleCount++;
    }
  }

  const debugStats: DetectionStats = {
    imgSize: `${width}x${height}`,
    mean: Math.round(stats.mean),
    threshold: Math.round(otsu),
    blackPct: Math.round((blackCount / sampleCount) * 100),
    candidateFound: false,
    totalCandidates: 0,
  };

  // collect candidates from all pixel-threshold × cell-threshold combos
  const allCandidates: { bbox: BBox; level: number; pxThresh: number }[] = [];
  const seen = new Set<string>();

  for (const pxThresh of pixelThresholds) {
    for (let li = 0; li < CELL_THRESHOLDS.length; li++) {
      const boxes = findCandidatesAtLevel(img, pxThresh, CELL_THRESHOLDS[li]);
      for (const bbox of boxes) {
        const key = `${Math.round(bbox.x / 10)}_${Math.round(bbox.y / 10)}_${Math.round(bbox.width / 10)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        allCandidates.push({ bbox, level: li, pxThresh });
      }
    }
  }

  debugStats.totalCandidates = allCandidates.length;

  // sort: prefer square-ish candidates, then by proximity to ideal area
  const imgArea = width * height;
  allCandidates.sort((a, b) => {
    const ratioA = Math.abs(1 - a.bbox.width / a.bbox.height);
    const ratioB = Math.abs(1 - b.bbox.width / b.bbox.height);
    if (Math.abs(ratioA - ratioB) > 0.05) return ratioA - ratioB;

    const areaA = (a.bbox.width * a.bbox.height) / imgArea;
    const areaB = (b.bbox.width * b.bbox.height) / imgArea;
    return Math.abs(areaA - 0.2) - Math.abs(areaB - 0.2);
  });

  // validate each candidate using the pixel threshold that found it
  let lastReject = '';
  for (const { bbox, level, pxThresh } of allCandidates) {
    const ratio = bbox.width / bbox.height;
    if (ratio < MIN_SQUARE_RATIO || ratio > MAX_SQUARE_RATIO) {
      lastReject = `not_square(${ratio.toFixed(2)})`;
      continue;
    }

    const result = validateMarker1(img, bbox, pxThresh);
    if (result.ok) {
      debugStats.candidateFound = true;
      debugStats.candidateBox = `${bbox.width}x${bbox.height}@(${bbox.x},${bbox.y})`;
      debugStats.squareRatio = Math.round(ratio * 100) / 100;
      debugStats.hitLevel = level;
      debugStats.hitThreshold = pxThresh;
      return { ...result, stats: debugStats };
    }

    lastReject = result.reason;
  }

  // Rotation fallback — try existing square-ish candidates rotated ±45°,
  // AND try merging fragmented candidates (diamond sides) into one bbox.
  const TILT_ANGLES = [45, -45];

  // first, try individual square candidates rotated
  for (const { bbox, level, pxThresh } of allCandidates) {
    const ratio = bbox.width / bbox.height;
    if (ratio < MIN_SQUARE_RATIO || ratio > MAX_SQUARE_RATIO) continue;

    const tiltHit = tryRotatedValidation(img, bbox, pxThresh, TILT_ANGLES);
    if (tiltHit) {
      debugStats.candidateFound = true;
      debugStats.candidateBox = `${bbox.width}x${bbox.height}@(${bbox.x},${bbox.y})`;
      debugStats.squareRatio = Math.round(ratio * 100) / 100;
      debugStats.hitLevel = level;
      debugStats.hitThreshold = pxThresh;
      return { ...tiltHit, stats: debugStats };
    }
  }

  // second, merge nearby candidates into a combined bbox and try rotation
  if (allCandidates.length >= 2) {
    const merged = mergeNearbyCandidates(allCandidates.map(c => c.bbox));
    for (const mbox of merged) {
      const ratio = mbox.width / mbox.height;
      if (ratio < MIN_SQUARE_RATIO || ratio > MAX_SQUARE_RATIO) continue;

      // try without rotation first (merged might be the full marker)
      const pxThresh = allCandidates[0].pxThresh;
      const direct = validateMarker1(img, mbox, pxThresh);
      if (direct.ok) {
        debugStats.candidateFound = true;
        debugStats.candidateBox = `${mbox.width}x${mbox.height}@(${mbox.x},${mbox.y}) merged`;
        debugStats.squareRatio = Math.round(ratio * 100) / 100;
        debugStats.hitThreshold = pxThresh;
        return { ...direct, stats: debugStats };
      }

      // try rotated
      const tiltHit = tryRotatedValidation(img, mbox, pxThresh, TILT_ANGLES);
      if (tiltHit) {
        debugStats.candidateFound = true;
        debugStats.candidateBox = `${mbox.width}x${mbox.height}@(${mbox.x},${mbox.y}) merged`;
        debugStats.squareRatio = Math.round(ratio * 100) / 100;
        debugStats.hitThreshold = pxThresh;
        return { ...tiltHit, stats: debugStats };
      }
    }
  }

  // nothing passed
  if (allCandidates.length > 0) {
    const best = allCandidates[0].bbox;
    debugStats.candidateBox = `${best.width}x${best.height}@(${best.x},${best.y})`;
    debugStats.squareRatio = Math.round((best.width / best.height) * 100) / 100;
    debugStats.rejectReason = lastReject;

    return {
      ok: false,
      reason: lastReject || 'validation_failed',
      stats: debugStats,
    };
  }

  return { ok: false, reason: 'no_candidates', stats: debugStats };
}

/** Try rotating a candidate bbox by each angle and validating the inscribed center. */
function tryRotatedValidation(
  img: ImageData,
  bbox: BBox,
  pxThresh: number,
  angles: number[]
): (DetectionResult & { tiltDegrees: number }) | null {
  const cropped = cropImageData(img, bbox);

  // try multiple pixel thresholds — camera blur softens edges after rotation
  const thresholds = dedupeThresholds([
    pxThresh,
    Math.round(pxThresh * 1.5),
    Math.round(pxThresh * 2.2),
  ]);

  for (const angle of angles) {
    const rotated = rotateImageData(cropped, angle);

    // approach 1: re-run candidate detection on the small rotated image.
    // this finds the axis-aligned marker naturally, regardless of centering offset.
    for (const thr of thresholds) {
      for (const cellThr of CELL_THRESHOLDS) {
        const subCandidates = findCandidatesAtLevel(rotated, thr, cellThr);
        for (const sub of subCandidates) {
          const ratio = sub.width / sub.height;
          if (ratio < MIN_SQUARE_RATIO || ratio > MAX_SQUARE_RATIO) continue;
          // use the same threshold that found this sub-candidate
          const result = validateMarker1(rotated, sub, thr);
          if (result.ok) {
            return {
              ok: true,
              bbox,
              anchor: result.anchor,
              confidence: result.confidence,
              debug: result.debug,
              tiltDegrees: angle,
            };
          }
        }
      }
    }

    // approach 2: brute-force innerBox at multiple sizes (fallback)
    const side = Math.min(rotated.width, rotated.height);
    const INNER_FACTORS = [0.60, 0.67, 0.71, 0.78];
    for (const factor of INNER_FACTORS) {
      const innerSize = Math.round(side * factor);
      const offX = Math.round((rotated.width - innerSize) / 2);
      const offY = Math.round((rotated.height - innerSize) / 2);
      const innerBox: BBox = { x: offX, y: offY, width: innerSize, height: innerSize };

      for (const thr of thresholds) {
        const result = validateMarker1(rotated, innerBox, thr);
        if (result.ok) {
          return {
            ok: true,
            bbox,
            anchor: result.anchor,
            confidence: result.confidence,
            debug: result.debug,
            tiltDegrees: angle,
          };
        }
      }
    }
  }

  return null;
}

/**
 * Merge nearby candidates into combined bounding boxes.
 * Handles diamond markers whose 4 sides fragment into separate candidates.
 */
function mergeNearbyCandidates(boxes: BBox[]): BBox[] {
  if (boxes.length < 2) return [];

  // compute center of each box
  const centers = boxes.map(b => ({
    x: b.x + b.width / 2,
    y: b.y + b.height / 2,
    box: b,
  }));

  // find the overall extent of all candidates
  const allX1 = boxes.map(b => b.x);
  const allY1 = boxes.map(b => b.y);
  const allX2 = boxes.map(b => b.x + b.width);
  const allY2 = boxes.map(b => b.y + b.height);

  const minX = Math.min(...allX1);
  const minY = Math.min(...allY1);
  const maxX = Math.max(...allX2);
  const maxY = Math.max(...allY2);

  const merged: BBox = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };

  // only return if the merged box is roughly square and reasonably sized
  const ratio = merged.width / merged.height;
  if (ratio < 0.70 || ratio > 1.40) return [];

  return [merged];
}

/** Remove pixel thresholds that are too close together. */
function dedupeThresholds(values: number[]): number[] {
  const clamped = values
    .map(v => Math.max(30, Math.min(200, v)))
    .sort((a, b) => a - b);
  const result = [clamped[0]];
  for (let i = 1; i < clamped.length; i++) {
    if (clamped[i] - result[result.length - 1] > 8) {
      result.push(clamped[i]);
    }
  }
  return result;
}

/**
 * Find candidate bounding boxes at a given cell density threshold.
 *
 * 1. Divide image into coarse grid cells
 * 2. Mark cells with black density above cellThreshold
 * 3. Flood-fill connected components of dark cells
 * 4. Return bounding boxes of components that could be markers
 */
function findCandidatesAtLevel(
  img: ImageData,
  pixelThreshold: number,
  cellThreshold: number
): BBox[] {
  const { width, height } = img;
  const cellSize = Math.max(6, Math.floor(Math.min(width, height) / 60));
  const cols = Math.ceil(width / cellSize);
  const rows = Math.ceil(height / cellSize);

  // build density grid
  const grid = new Float32Array(rows * cols);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x0 = c * cellSize;
      const y0 = r * cellSize;
      const w = Math.min(cellSize, width - x0);
      const h = Math.min(cellSize, height - y0);
      grid[r * cols + c] = regionDensity(img, x0, y0, w, h, pixelThreshold);
    }
  }

  // mark dark cells
  const dark = new Uint8Array(rows * cols);
  for (let i = 0; i < grid.length; i++) {
    dark[i] = grid[i] >= cellThreshold ? 1 : 0;
  }

  // flood fill connected components (8-connectivity for diagonal borders)
  const visited = new Uint8Array(rows * cols);
  const components: { minR: number; maxR: number; minC: number; maxC: number; size: number }[] = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      if (!dark[idx] || visited[idx]) continue;

      let minR = r, maxR = r, minC = c, maxC = c, size = 0;
      const queue = [idx];
      visited[idx] = 1;

      while (queue.length > 0) {
        const cur = queue.pop()!;
        const cr = Math.floor(cur / cols);
        const cc = cur % cols;

        size++;
        if (cr < minR) minR = cr;
        if (cr > maxR) maxR = cr;
        if (cc < minC) minC = cc;
        if (cc > maxC) maxC = cc;

        const neighbors = [
          cr > 0 ? (cr - 1) * cols + cc : -1,
          cr < rows - 1 ? (cr + 1) * cols + cc : -1,
          cc > 0 ? cr * cols + (cc - 1) : -1,
          cc < cols - 1 ? cr * cols + (cc + 1) : -1,
          // diagonals for tilted marker borders
          cr > 0 && cc > 0 ? (cr - 1) * cols + (cc - 1) : -1,
          cr > 0 && cc < cols - 1 ? (cr - 1) * cols + (cc + 1) : -1,
          cr < rows - 1 && cc > 0 ? (cr + 1) * cols + (cc - 1) : -1,
          cr < rows - 1 && cc < cols - 1 ? (cr + 1) * cols + (cc + 1) : -1,
        ];

        for (const n of neighbors) {
          if (n >= 0 && dark[n] && !visited[n]) {
            visited[n] = 1;
            queue.push(n);
          }
        }
      }

      components.push({ minR, maxR, minC, maxC, size });
    }
  }

  const imgArea = width * height;
  const results: BBox[] = [];

  for (const comp of components) {
    const bboxCellW = comp.maxC - comp.minC + 1;
    const bboxCellH = comp.maxR - comp.minR + 1;
    if (bboxCellW < 3 || bboxCellH < 3) continue;
    if (comp.size < 4) continue;

    const px = comp.minC * cellSize;
    const py = comp.minR * cellSize;
    const pw = Math.min(bboxCellW * cellSize, width - px);
    const ph = Math.min(bboxCellH * cellSize, height - py);

    const area = pw * ph;
    if (area < imgArea * 0.005) continue;
    if (area > imgArea * 0.92) continue;

    results.push({ x: px, y: py, width: pw, height: ph });
  }

  return results;
}
