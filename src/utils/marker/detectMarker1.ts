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
  candidatesChecked?: number;
}

export function detectMarker1(
  img: ImageData,
  thresholdOverride?: number
): DetectionResult & { stats?: DetectionStats } {
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
    candidatesChecked: 0,
  };

  const candidates = findCandidates(img, threshold);
  debugStats.candidatesChecked = candidates.length;

  // try each candidate (largest first) through full validation
  for (const bbox of candidates) {
    const ratio = bbox.width / bbox.height;
    if (ratio < MIN_SQUARE_RATIO || ratio > MAX_SQUARE_RATIO) continue;

    const result = validateMarker1(img, bbox, threshold);
    if (result.ok) {
      debugStats.candidateFound = true;
      debugStats.candidateBox = `${bbox.width}x${bbox.height} at (${bbox.x},${bbox.y})`;
      debugStats.squareRatio = Math.round(ratio * 100) / 100;
      return { ...result, stats: debugStats };
    }
  }

  // none passed validation — report the best candidate for debug
  if (candidates.length > 0) {
    const best = candidates[0];
    debugStats.candidateBox = `${best.width}x${best.height} at (${best.x},${best.y})`;
    debugStats.squareRatio = Math.round((best.width / best.height) * 100) / 100;

    const ratio = best.width / best.height;
    if (ratio < MIN_SQUARE_RATIO || ratio > MAX_SQUARE_RATIO) {
      return {
        ok: false,
        reason: `candidate_not_square (${candidates.length} checked)`,
        debug: { squareRatio: ratio } as any,
        stats: debugStats,
      };
    }

    const failResult = validateMarker1(img, best, threshold);
    return { ...failResult, stats: debugStats };
  }

  return { ok: false, reason: 'no_candidate_found', stats: debugStats };
}

/**
 * Grid-based candidate finder.
 *
 * 1. Divide image into coarse cells
 * 2. Mark cells with high black density
 * 3. Flood-fill to find connected components of dark cells
 * 4. Convert each component's bounding box to pixel coordinates
 * 5. Return candidates sorted by area (largest first)
 */
function findCandidates(img: ImageData, threshold: number): BBox[] {
  const { width, height } = img;
  const cellSize = Math.max(8, Math.floor(Math.min(width, height) / 50));
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
      grid[r * cols + c] = regionDensity(img, x0, y0, w, h, threshold);
    }
  }

  // mark dark cells — a cell is "dark" if >35% of its pixels are black
  const CELL_DENSITY_THRESHOLD = 0.35;
  const dark = new Uint8Array(rows * cols);
  for (let i = 0; i < grid.length; i++) {
    dark[i] = grid[i] >= CELL_DENSITY_THRESHOLD ? 1 : 0;
  }

  // flood fill to find connected components
  const visited = new Uint8Array(rows * cols);
  const components: { minR: number; maxR: number; minC: number; maxC: number; size: number }[] = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      if (!dark[idx] || visited[idx]) continue;

      // BFS flood fill
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

        // 4-connected neighbors
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

  // filter: at least 4x4 cells, reject very tiny or very huge components
  const imgArea = width * height;
  const results: BBox[] = [];

  for (const comp of components) {
    const bboxCellW = comp.maxC - comp.minC + 1;
    const bboxCellH = comp.maxR - comp.minR + 1;
    if (bboxCellW < 4 || bboxCellH < 4) continue;

    const px = comp.minC * cellSize;
    const py = comp.minR * cellSize;
    const pw = Math.min(bboxCellW * cellSize, width - px);
    const ph = Math.min(bboxCellH * cellSize, height - py);

    const area = pw * ph;
    if (area < imgArea * 0.01) continue;
    if (area > imgArea * 0.95) continue;

    results.push({ x: px, y: py, width: pw, height: ph });
  }

  // sort by area descending — largest candidate first
  results.sort((a, b) => (b.width * b.height) - (a.width * a.height));

  return results;
}
