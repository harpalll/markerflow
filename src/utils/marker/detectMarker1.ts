import type { ImageData, BBox, DetectionResult } from '../../types/marker';
import { grayAt, isBlack } from '../image/pixelUtils';
import { validateMarker1 } from './validateMarker1';
import {
  MIN_SQUARE_RATIO,
  MAX_SQUARE_RATIO,
} from '../../constants/scanner';

/**
 * Main entry point: takes decoded image data, finds a Marker 1 candidate,
 * validates its structure, and returns the result.
 */
export function detectMarker1(img: ImageData): DetectionResult {
  const candidate = findCandidate(img);
  if (!candidate) {
    return { ok: false, reason: 'no_candidate_found' };
  }

  const ratio = candidate.width / candidate.height;
  if (ratio < MIN_SQUARE_RATIO || ratio > MAX_SQUARE_RATIO) {
    return {
      ok: false,
      reason: 'candidate_not_square',
      debug: { squareRatio: ratio } as any,
    };
  }

  return validateMarker1(img, candidate);
}

/**
 * Scan the image for a rectangular region of dense black pixels
 * that could be the Marker 1 outer border.
 *
 * Strategy: find the tight bounding box of all "black" pixels,
 * then verify it occupies a reasonable portion of the frame.
 */
function findCandidate(img: ImageData): BBox | null {
  const { width, height } = img;

  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;

  // scan with step for speed — every 2nd pixel on each axis
  const step = Math.max(1, Math.floor(Math.min(width, height) / 250));

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      if (isBlack(grayAt(img, x, y))) {
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

  // reject tiny noise or things that fill the entire frame
  const imgArea = width * height;
  const bboxArea = bw * bh;
  if (bboxArea < imgArea * 0.02) return null; // too small
  if (bboxArea > imgArea * 0.98) return null; // fills entire frame — probably background

  return { x: minX, y: minY, width: bw, height: bh };
}
