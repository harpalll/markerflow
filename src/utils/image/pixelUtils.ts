import { BLACK_THRESHOLD } from '../../constants/scanner';
import type { ImageData, BBox } from '../../types/marker';

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

/**
 * Locate the largest bright region in the image.
 * When the camera captures a marker on a laptop screen, the screen's white
 * areas form a distinct bright cluster surrounded by dark desk/bezel.
 * Returns the bounding box of that cluster, or null if nothing useful found.
 */
export function findBrightRegion(img: ImageData, brightThreshold = 150): BBox | null {
  const { width, height } = img;
  const cellSize = Math.max(6, Math.floor(Math.min(width, height) / 60));
  const cols = Math.ceil(width / cellSize);
  const rows = Math.ceil(height / cellSize);

  // brightness density per cell — fraction of pixels above brightThreshold
  const grid = new Float32Array(rows * cols);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x0 = c * cellSize;
      const y0 = r * cellSize;
      const cellW = Math.min(cellSize, width - x0);
      const cellH = Math.min(cellSize, height - y0);

      let bright = 0;
      let total = 0;
      for (let py = y0; py < y0 + cellH; py++) {
        for (let px = x0; px < x0 + cellW; px++) {
          if (grayAt(img, px, py) > brightThreshold) bright++;
          total++;
        }
      }
      grid[r * cols + c] = total > 0 ? bright / total : 0;
    }
  }

  // mark cells with enough bright pixels
  const lit = new Uint8Array(rows * cols);
  for (let i = 0; i < grid.length; i++) {
    lit[i] = grid[i] >= 0.35 ? 1 : 0;
  }

  // flood-fill connected components, keep the largest
  const visited = new Uint8Array(rows * cols);
  let best: { minR: number; maxR: number; minC: number; maxC: number; size: number } | null = null;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      if (!lit[idx] || visited[idx]) continue;

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

        for (const n of [
          cr > 0 ? (cr - 1) * cols + cc : -1,
          cr < rows - 1 ? (cr + 1) * cols + cc : -1,
          cc > 0 ? cr * cols + (cc - 1) : -1,
          cc < cols - 1 ? cr * cols + (cc + 1) : -1,
        ]) {
          if (n >= 0 && lit[n] && !visited[n]) {
            visited[n] = 1;
            queue.push(n);
          }
        }
      }

      if (!best || size > best.size) {
        best = { minR, maxR, minC, maxC, size };
      }
    }
  }

  if (!best) return null;

  // convert cell coords to pixels, add padding for border coverage
  const pad = cellSize * 2;
  const bx = Math.max(0, best.minC * cellSize - pad);
  const by = Math.max(0, best.minR * cellSize - pad);
  const bx2 = Math.min(width, (best.maxC + 1) * cellSize + pad);
  const by2 = Math.min(height, (best.maxR + 1) * cellSize + pad);
  const rw = bx2 - bx;
  const rh = by2 - by;

  // too small = noise, too large = no useful cropping
  const area = rw * rh;
  const imgArea = width * height;
  if (area < imgArea * 0.10 || area > imgArea * 0.85) return null;

  return { x: bx, y: by, width: rw, height: rh };
}

/**
 * Crop RGBA pixel data to a sub-region.
 */
export function cropImageData(img: ImageData, bbox: BBox): ImageData {
  const { x: sx, y: sy, width: bw, height: bh } = bbox;
  const out = new Uint8Array(bw * bh * 4);

  for (let row = 0; row < bh; row++) {
    const srcY = sy + row;
    if (srcY >= img.height) break;
    const srcOff = srcY * img.width;
    const dstOff = row * bw;
    for (let col = 0; col < bw; col++) {
      const srcX = sx + col;
      if (srcX >= img.width) break;
      const si = (srcOff + srcX) * 4;
      const di = (dstOff + col) * 4;
      out[di] = img.data[si];
      out[di + 1] = img.data[si + 1];
      out[di + 2] = img.data[si + 2];
      out[di + 3] = img.data[si + 3];
    }
  }

  return { width: bw, height: bh, data: out };
}

/**
 * Rotate RGBA pixel data by an arbitrary angle (degrees, clockwise).
 * Uses nearest-neighbor sampling. Empty areas filled with white.
 */
export function rotateImageData(img: ImageData, angleDeg: number): ImageData {
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const { width: w, height: h } = img;

  const out = new Uint8Array(w * h * 4);
  // fill white
  for (let i = 0; i < out.length; i += 4) {
    out[i] = 255; out[i + 1] = 255; out[i + 2] = 255; out[i + 3] = 255;
  }

  const cx = w / 2;
  const cy = h / 2;

  for (let y = 0; y < h; y++) {
    const dy = y - cy;
    for (let x = 0; x < w; x++) {
      const dx = x - cx;
      // inverse mapping: where does this output pixel come from?
      const srcXf = cos * dx + sin * dy + cx;
      const srcYf = -sin * dx + cos * dy + cy;

      // bilinear interpolation for smoother edges
      const x0 = Math.floor(srcXf);
      const y0 = Math.floor(srcYf);
      const x1 = x0 + 1;
      const y1 = y0 + 1;

      if (x0 < 0 || x1 >= w || y0 < 0 || y1 >= h) continue;

      const fx = srcXf - x0;
      const fy = srcYf - y0;
      const w00 = (1 - fx) * (1 - fy);
      const w10 = fx * (1 - fy);
      const w01 = (1 - fx) * fy;
      const w11 = fx * fy;

      const i00 = (y0 * w + x0) * 4;
      const i10 = (y0 * w + x1) * 4;
      const i01 = (y1 * w + x0) * 4;
      const i11 = (y1 * w + x1) * 4;

      const di = (y * w + x) * 4;
      out[di]     = Math.round(img.data[i00] * w00 + img.data[i10] * w10 + img.data[i01] * w01 + img.data[i11] * w11);
      out[di + 1] = Math.round(img.data[i00 + 1] * w00 + img.data[i10 + 1] * w10 + img.data[i01 + 1] * w01 + img.data[i11 + 1] * w11);
      out[di + 2] = Math.round(img.data[i00 + 2] * w00 + img.data[i10 + 2] * w10 + img.data[i01 + 2] * w01 + img.data[i11 + 2] * w11);
      out[di + 3] = 255;
    }
  }

  return { width: w, height: h, data: out };
}
