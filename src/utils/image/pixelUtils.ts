import { BLACK_THRESHOLD } from '../../constants/scanner';
import type { ImageData } from '../../types/marker';

/** Grayscale from RGBA pixel at (x, y). */
export function grayAt(img: ImageData, x: number, y: number): number {
  const i = (y * img.width + x) * 4;
  return img.data[i] * 0.299 + img.data[i + 1] * 0.587 + img.data[i + 2] * 0.114;
}

/** Whether a pixel counts as "black" at a given threshold. */
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

  let black = 0;
  let total = 0;

  // sample every other pixel for speed on larger regions
  const step = w * h > 10000 ? 2 : 1;

  for (let y = y0; y < yEnd; y += step) {
    for (let x = x0; x < xEnd; x += step) {
      if (grayAt(img, x, y) < threshold) black++;
      total++;
    }
  }

  return total === 0 ? 0 : black / total;
}

/**
 * Downscale RGBA image to target size (nearest-neighbor).
 * Fast and good enough for detection pre-processing.
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
