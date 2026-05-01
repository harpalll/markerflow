import { BLACK_THRESHOLD } from '../../constants/scanner';
import type { ImageData } from '../../types/marker';

export function grayAt(img: ImageData, x: number, y: number): number {
  const i = (y * img.width + x) * 4;
  return img.data[i] * 0.299 + img.data[i + 1] * 0.587 + img.data[i + 2] * 0.114;
}

export function isBlack(gray: number, threshold = BLACK_THRESHOLD): boolean {
  return gray < threshold;
}

/**
 * Black pixel density in a rectangular region.
 * Returns 0..1 — fraction of pixels below threshold.
 */
export function regionDensity(
  img: ImageData,
  x0: number,
  y0: number,
  w: number,
  h: number,
  threshold = BLACK_THRESHOLD
): number {
  const xEnd = Math.min(x0 + w, img.width);
  const yEnd = Math.min(y0 + h, img.height);
  const xStart = Math.max(0, x0);
  const yStart = Math.max(0, y0);

  let black = 0;
  let total = 0;

  const step = w * h > 10000 ? 2 : 1;

  for (let y = yStart; y < yEnd; y += step) {
    for (let x = xStart; x < xEnd; x += step) {
      if (grayAt(img, x, y) < threshold) black++;
      total++;
    }
  }

  return total === 0 ? 0 : black / total;
}

/**
 * Compute image statistics for adaptive thresholding.
 * Samples a subset of pixels for speed.
 */
export function imageStats(img: ImageData): { mean: number; min: number; max: number } {
  const { width, height, data } = img;
  const step = Math.max(1, Math.floor(Math.min(width, height) / 150));

  let sum = 0;
  let count = 0;
  let lo = 255;
  let hi = 0;

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const g = grayAt(img, x, y);
      sum += g;
      if (g < lo) lo = g;
      if (g > hi) hi = g;
      count++;
    }
  }

  return { mean: sum / count, min: lo, max: hi };
}

/**
 * Compute a threshold that separates dark (marker border) from light (background).
 * Uses Otsu-lite: find the gray value that best splits the bimodal histogram.
 * Falls back to a fraction of the mean if the histogram isn't clearly bimodal.
 */
export function computeAdaptiveThreshold(img: ImageData): number {
  const { width, height } = img;
  const step = Math.max(1, Math.floor(Math.min(width, height) / 120));

  // build a 64-bin histogram
  const bins = 64;
  const hist = new Uint32Array(bins);
  let total = 0;

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const g = grayAt(img, x, y);
      const bin = Math.min(bins - 1, Math.floor(g / (256 / bins)));
      hist[bin]++;
      total++;
    }
  }

  // Otsu's method on the histogram
  let sumAll = 0;
  for (let i = 0; i < bins; i++) sumAll += i * hist[i];

  let sumB = 0;
  let wB = 0;
  let maxVariance = 0;
  let bestBin = 0;

  for (let i = 0; i < bins; i++) {
    wB += hist[i];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;

    sumB += i * hist[i];
    const mB = sumB / wB;
    const mF = (sumAll - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);

    if (between > maxVariance) {
      maxVariance = between;
      bestBin = i;
    }
  }

  const otsuThreshold = (bestBin + 0.5) * (256 / bins);

  // clamp to a reasonable range so we don't get wild values
  return Math.max(60, Math.min(180, otsuThreshold));
}

/**
 * Downscale RGBA image to target size (nearest-neighbor).
 */
export function downscale(img: ImageData, targetSize: number): ImageData {
  const ratio = Math.min(targetSize / img.width, targetSize / img.height);
  if (ratio >= 1) return img;

  const w = Math.floor(img.width * ratio);
  const h = Math.floor(img.height * ratio);
  const out = new Uint8Array(w * h * 4);

  for (let y = 0; y < h; y++) {
    const srcY = Math.floor(y / ratio);
    for (let x = 0; x < w; x++) {
      const srcX = Math.floor(x / ratio);
      const si = (srcY * img.width + srcX) * 4;
      const di = (y * w + x) * 4;
      out[di] = img.data[si];
      out[di + 1] = img.data[si + 1];
      out[di + 2] = img.data[si + 2];
      out[di + 3] = img.data[si + 3];
    }
  }

  return { width: w, height: h, data: out };
}
