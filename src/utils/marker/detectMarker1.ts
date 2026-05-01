import type { ImageData, BBox, DetectionResult } from '../../types/marker';
import { grayAt, isBlack, imageStats, computeAdaptiveThreshold } from '../image/pixelUtils';
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
}

/**
 * Main entry point: takes decoded image data, finds a Marker 1 candidate,
 * validates its structure, and returns the result.
 * Also returns stats for debug display.
 */
export function detectMarker1(
  img: ImageData,
  thresholdOverride?: number
): DetectionResult & { stats?: DetectionStats } {
  const stats = imageStats(img);
  const threshold = thresholdOverride ?? computeAdaptiveThreshold(img);

  // count black pixels at this threshold
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
  const blackPct = sampleCount > 0 ? blackCount / sampleCount : 0;

  const debugStats: DetectionStats = {
    imgSize: `${width}x${height}`,
    mean: Math.round(stats.mean),
    threshold: Math.round(threshold),
    blackPct: Math.round(blackPct * 100),
    candidateFound: false,
  };

  const candidate = findCandidate(img, threshold);
  if (!candidate) {
    return { ok: false, reason: 'no_candidate_found', stats: debugStats };
  }

  debugStats.candidateFound = true;
  debugStats.candidateBox = `${candidate.width}x${candidate.height} at (${candidate.x},${candidate.y})`;

  const ratio = candidate.width / candidate.height;
  debugStats.squareRatio = Math.round(ratio * 100) / 100;

  if (ratio < MIN_SQUARE_RATIO || ratio > MAX_SQUARE_RATIO) {
    return {
      ok: false,
      reason: 'candidate_not_square',
      debug: { squareRatio: ratio } as any,
      stats: debugStats,
    };
  }

  const result = validateMarker1(img, candidate, threshold);
  return { ...result, stats: debugStats };
}

/**
 * Scan for the bounding box of all "black" pixels in the image.
 * Uses the adaptive threshold instead of a fixed constant.
 */
function findCandidate(img: ImageData, threshold: number): BBox | null {
  const { width, height } = img;

  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;

  const step = Math.max(1, Math.floor(Math.min(width, height) / 250));

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      if (isBlack(grayAt(img, x, y), threshold)) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX <= minX || maxY <= minY) return null;

  const bw = maxX - minX;
  const bh = maxY - minY;

  const imgArea = width * height;
  const bboxArea = bw * bh;
  if (bboxArea < imgArea * 0.01) return null;
  if (bboxArea > imgArea * 0.98) return null;

  return { x: minX, y: minY, width: bw, height: bh };
}
