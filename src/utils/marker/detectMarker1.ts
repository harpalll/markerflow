import type { ImageData, BBox, DetectionResult } from '../../types/marker';
import { grayAt, imageStats, computeAdaptiveThreshold, regionDensity } from '../image/pixelUtils';
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
  rejectReason?: string;
}

// cell density thresholds — run grid analysis at each level
// lower catches faint markers, higher splits merged clusters
const CELL_THRESHOLDS = [0.30, 0.45, 0.60];

export function detectMarker1(
  img: ImageData,
  thresholdOverride?: number
): DetectionResult & { stats: DetectionStats } {
  const stats = imageStats(img);
  const threshold = thresholdOverride ?? computeAdaptiveThreshold(img);

  const { width, height } = img;
  const step = Math.max(1, Math.floor(Math.min(width, height) / 200));
  let blackCount = 0;
  let sampleCount = 0;
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      if (grayAt(img, x, y) < threshold) blackCount++;
      sampleCount++;
    }
  }

  const debugStats: DetectionStats = {
    imgSize: `${width}x${height}`,
    mean: Math.round(stats.mean),
    threshold: Math.round(threshold),
    blackPct: Math.round((blackCount / sampleCount) * 100),
    candidateFound: false,
    totalCandidates: 0,
  };

  // collect candidates from all cell density levels
  const allCandidates: { bbox: BBox; level: number }[] = [];
  const seen = new Set<string>();

  for (let li = 0; li < CELL_THRESHOLDS.length; li++) {
    const boxes = findCandidatesAtLevel(img, threshold, CELL_THRESHOLDS[li]);
    for (const bbox of boxes) {
      // dedupe: skip if we already have a very similar box
      const key = `${Math.round(bbox.x / 10)}_${Math.round(bbox.y / 10)}_${Math.round(bbox.width / 10)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      allCandidates.push({ bbox, level: li });
    }
  }

  debugStats.totalCandidates = allCandidates.length;

  // sort: prefer square-ish candidates, then by area (mid-size first)
  const imgArea = width * height;
  allCandidates.sort((a, b) => {
    const ratioA = Math.abs(1 - a.bbox.width / a.bbox.height);
    const ratioB = Math.abs(1 - b.bbox.width / b.bbox.height);
    if (Math.abs(ratioA - ratioB) > 0.05) return ratioA - ratioB;

    // prefer candidates that fill 5-50% of the frame
    const areaA = (a.bbox.width * a.bbox.height) / imgArea;
    const areaB = (b.bbox.width * b.bbox.height) / imgArea;
    const idealA = Math.abs(areaA - 0.2);
    const idealB = Math.abs(areaB - 0.2);
    return idealA - idealB;
  });

  // try each candidate through validation
  let lastReject = '';
  for (const { bbox, level } of allCandidates) {
    const ratio = bbox.width / bbox.height;
    if (ratio < MIN_SQUARE_RATIO || ratio > MAX_SQUARE_RATIO) {
      lastReject = `not_square(${ratio.toFixed(2)})`;
      continue;
    }

    const result = validateMarker1(img, bbox, threshold);
    if (result.ok) {
      debugStats.candidateFound = true;
      debugStats.candidateBox = `${bbox.width}x${bbox.height}@(${bbox.x},${bbox.y})`;
      debugStats.squareRatio = Math.round(ratio * 100) / 100;
      debugStats.hitLevel = level;
      return { ...result, stats: debugStats };
    }

    // track why it failed for debug
    if (!result.ok) {
      lastReject = result.reason;
    }
  }

  // nothing passed — build a useful debug message
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

  // flood fill connected components
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
