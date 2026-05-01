import type { ImageData } from '../../types/marker';

/**
 * Generate a synthetic Marker 1 image as raw RGBA pixel data.
 * White background, black square border, small black anchor in one corner.
 */
export function generateMarker1(
  size: number,
  anchorCorner: 'top-left' | 'top-right' | 'bottom-right' | 'bottom-left',
  padding = 20
): ImageData {
  const total = size + padding * 2;
  const data = new Uint8Array(total * total * 4);

  // fill white
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 255;
    data[i + 1] = 255;
    data[i + 2] = 255;
    data[i + 3] = 255;
  }

  const set = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= total || y >= total) return;
    const i = (y * total + x) * 4;
    data[i] = 0;
    data[i + 1] = 0;
    data[i + 2] = 0;
  };

  const fillRect = (rx: number, ry: number, rw: number, rh: number) => {
    for (let y = ry; y < ry + rh; y++) {
      for (let x = rx; x < rx + rw; x++) {
        set(x, y);
      }
    }
  };

  const ox = padding;
  const oy = padding;
  const borderW = Math.round(size * 0.12);

  // draw 4 border bands
  fillRect(ox, oy, size, borderW); // top
  fillRect(ox, oy + size - borderW, size, borderW); // bottom
  fillRect(ox, oy, borderW, size); // left
  fillRect(ox + size - borderW, oy, borderW, size); // right

  // draw anchor — small square in one corner, inside the border
  const anchorSize = Math.round(size * 0.14);
  const anchorInset = borderW + Math.round(size * 0.03);

  let ax: number, ay: number;
  switch (anchorCorner) {
    case 'top-left':
      ax = ox + anchorInset;
      ay = oy + anchorInset;
      break;
    case 'top-right':
      ax = ox + size - anchorInset - anchorSize;
      ay = oy + anchorInset;
      break;
    case 'bottom-right':
      ax = ox + size - anchorInset - anchorSize;
      ay = oy + size - anchorInset - anchorSize;
      break;
    case 'bottom-left':
      ax = ox + anchorInset;
      ay = oy + size - anchorInset - anchorSize;
      break;
  }

  fillRect(ax, ay, anchorSize, anchorSize);

  return { width: total, height: total, data };
}

/** Marker 1 border only — no anchor. Should be REJECTED. */
export function generateBorderOnly(size: number, padding = 20): ImageData {
  const total = size + padding * 2;
  const data = new Uint8Array(total * total * 4);

  for (let i = 0; i < data.length; i += 4) {
    data[i] = 255; data[i + 1] = 255; data[i + 2] = 255; data[i + 3] = 255;
  }

  const set = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= total || y >= total) return;
    const i = (y * total + x) * 4;
    data[i] = 0; data[i + 1] = 0; data[i + 2] = 0;
  };

  const fillRect = (rx: number, ry: number, rw: number, rh: number) => {
    for (let y = ry; y < ry + rh; y++)
      for (let x = rx; x < rx + rw; x++) set(x, y);
  };

  const ox = padding, oy = padding;
  const borderW = Math.round(size * 0.12);

  fillRect(ox, oy, size, borderW);
  fillRect(ox, oy + size - borderW, size, borderW);
  fillRect(ox, oy, borderW, size);
  fillRect(ox + size - borderW, oy, borderW, size);

  return { width: total, height: total, data };
}

/** Marker with a large block in corner — anchor too big. Should be REJECTED. */
export function generateLargeAnchor(size: number, padding = 20): ImageData {
  const img = generateBorderOnly(size, padding);
  const ox = padding, oy = padding;
  const borderW = Math.round(size * 0.12);

  // oversized block — 35% of marker side
  const blockSize = Math.round(size * 0.35);
  const inset = borderW + Math.round(size * 0.02);

  const fillRect = (rx: number, ry: number, rw: number, rh: number) => {
    for (let y = ry; y < ry + rh; y++) {
      for (let x = rx; x < rx + rw; x++) {
        if (x >= 0 && y >= 0 && x < img.width && y < img.height) {
          const i = (y * img.width + x) * 4;
          img.data[i] = 0; img.data[i + 1] = 0; img.data[i + 2] = 0;
        }
      }
    }
  };

  fillRect(ox + inset, oy + inset, blockSize, blockSize);

  return img;
}

/** Marker with a black block in the center. Should be REJECTED. */
export function generateCenterBlock(size: number, padding = 20): ImageData {
  const img = generateBorderOnly(size, padding);
  const ox = padding, oy = padding;

  const blockSize = Math.round(size * 0.25);
  const cx = ox + Math.round((size - blockSize) / 2);
  const cy = oy + Math.round((size - blockSize) / 2);

  for (let y = cy; y < cy + blockSize; y++) {
    for (let x = cx; x < cx + blockSize; x++) {
      if (x >= 0 && y >= 0 && x < img.width && y < img.height) {
        const i = (y * img.width + x) * 4;
        img.data[i] = 0; img.data[i + 1] = 0; img.data[i + 2] = 0;
      }
    }
  }

  return img;
}

/** Large internal fill — too much black inside. Should be REJECTED. */
export function generateHeavyFill(size: number, padding = 20): ImageData {
  const img = generateBorderOnly(size, padding);
  const ox = padding, oy = padding;
  const borderW = Math.round(size * 0.12);

  // fill 60% of the inner area
  const fillW = Math.round(size * 0.50);
  const fillH = Math.round(size * 0.50);
  const fx = ox + borderW + Math.round(size * 0.03);
  const fy = oy + borderW + Math.round(size * 0.03);

  for (let y = fy; y < fy + fillH; y++) {
    for (let x = fx; x < fx + fillW; x++) {
      if (x >= 0 && y >= 0 && x < img.width && y < img.height) {
        const i = (y * img.width + x) * 4;
        img.data[i] = 0; img.data[i + 1] = 0; img.data[i + 2] = 0;
      }
    }
  }

  return img;
}
