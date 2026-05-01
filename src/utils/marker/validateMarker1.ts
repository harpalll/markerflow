import type { ImageData, BBox, DetectionResult, AnchorPosition, MarkerDebugInfo } from '../../types/marker';
import { regionDensity } from '../image/pixelUtils';
import {
  BLACK_THRESHOLD,
  MIN_BORDER_DENSITY,
  MIN_ANCHOR_DENSITY,
  MAX_CENTER_DENSITY,
  MAX_INNER_DENSITY,
  BORDER_BAND,
  ANCHOR_INSET_START,
  ANCHOR_INSET_END,
  MAX_ANCHOR_SIDE_RATIO,
} from '../../constants/scanner';

/**
 * Validate that a candidate bounding box actually contains Marker 1.
 * Uses the provided threshold for all density checks.
 */
export function validateMarker1(
  img: ImageData,
  bbox: BBox,
  threshold = BLACK_THRESHOLD
): DetectionResult {
  const { x, y, width: bw, height: bh } = bbox;
  const borderW = Math.round(bw * BORDER_BAND);
  const borderH = Math.round(bh * BORDER_BAND);

  const topD = regionDensity(img, x, y, bw, borderH, threshold);
  const bottomD = regionDensity(img, x, y + bh - borderH, bw, borderH, threshold);
  const leftD = regionDensity(img, x, y, borderW, bh, threshold);
  const rightD = regionDensity(img, x + bw - borderW, y, borderW, bh, threshold);

  const borderDensity = { top: topD, bottom: bottomD, left: leftD, right: rightD };

  const failedBorders = Object.entries(borderDensity)
    .filter(([_, d]) => d < MIN_BORDER_DENSITY);

  if (failedBorders.length > 0) {
    return {
      ok: false,
      reason: `border_too_thin:${failedBorders.map(([s]) => s).join(',')}`,
      debug: { borderDensity, squareRatio: bw / bh } as any,
    };
  }

  // inner area — exclude borders
  const innerX = x + borderW + Math.round(bw * 0.05);
  const innerY = y + borderH + Math.round(bh * 0.05);
  const innerW = bw - 2 * borderW - Math.round(bw * 0.1);
  const innerH = bh - 2 * borderH - Math.round(bh * 0.1);
  const innerD = regionDensity(img, innerX, innerY, innerW, innerH, threshold);

  if (innerD > MAX_INNER_DENSITY) {
    return {
      ok: false,
      reason: 'inner_black_density_too_high',
      debug: { borderDensity, innerDensity: innerD, squareRatio: bw / bh } as any,
    };
  }

  // center region
  const cx = x + Math.round(bw * 0.35);
  const cy = y + Math.round(bh * 0.35);
  const cw = Math.round(bw * 0.30);
  const ch = Math.round(bh * 0.30);
  const centerD = regionDensity(img, cx, cy, cw, ch, threshold);

  if (centerD > MAX_CENTER_DENSITY) {
    return {
      ok: false,
      reason: 'center_black_density_too_high',
      debug: { borderDensity, innerDensity: innerD, centerDensity: centerD, squareRatio: bw / bh } as any,
    };
  }

  const anchorResult = findAnchor(img, bbox, threshold);
  if (!anchorResult.found) {
    return {
      ok: false,
      reason: anchorResult.reason,
      debug: {
        borderDensity,
        innerDensity: innerD,
        centerDensity: centerD,
        anchorDensities: anchorResult.densities,
        squareRatio: bw / bh,
      },
    };
  }

  const debug: MarkerDebugInfo = {
    borderDensity,
    anchorDensities: anchorResult.densities,
    innerDensity: innerD,
    centerDensity: centerD,
    squareRatio: bw / bh,
  };

  const avgBorder = (topD + bottomD + leftD + rightD) / 4;
  const confidence = avgBorder * 0.5
    + anchorResult.densities[anchorResult.position!] * 0.3
    + (1 - innerD) * 0.2;

  return {
    ok: true,
    bbox,
    anchor: anchorResult.position!,
    confidence,
    debug,
  };
}

interface AnchorResult {
  found: boolean;
  position?: AnchorPosition;
  reason: string;
  densities: Record<AnchorPosition, number>;
}

function findAnchor(img: ImageData, bbox: BBox, threshold: number): AnchorResult {
  const { x, y, width: bw, height: bh } = bbox;
  const s0 = ANCHOR_INSET_START;
  const s1 = ANCHOR_INSET_END;

  const corners: Record<AnchorPosition, [number, number, number, number]> = {
    'top-left':     [x + Math.round(bw * s0), y + Math.round(bh * s0), Math.round(bw * (s1 - s0)), Math.round(bh * (s1 - s0))],
    'top-right':    [x + Math.round(bw * (1 - s1)), y + Math.round(bh * s0), Math.round(bw * (s1 - s0)), Math.round(bh * (s1 - s0))],
    'bottom-left':  [x + Math.round(bw * s0), y + Math.round(bh * (1 - s1)), Math.round(bw * (s1 - s0)), Math.round(bh * (s1 - s0))],
    'bottom-right': [x + Math.round(bw * (1 - s1)), y + Math.round(bh * (1 - s1)), Math.round(bw * (s1 - s0)), Math.round(bh * (s1 - s0))],
  };

  const densities = {} as Record<AnchorPosition, number>;
  const positions = Object.keys(corners) as AnchorPosition[];

  for (const pos of positions) {
    const [rx, ry, rw, rh] = corners[pos];
    densities[pos] = regionDensity(img, rx, ry, rw, rh, threshold);
  }

  const hits = positions.filter(p => densities[p] >= MIN_ANCHOR_DENSITY);

  if (hits.length === 0) {
    // no corner meets absolute threshold — try relative comparison.
    // if one corner is clearly denser than all others, it's likely
    // the anchor degraded by camera blur or small marker size.
    const sorted = [...positions].sort((a, b) => densities[b] - densities[a]);
    const best = densities[sorted[0]];
    const second = densities[sorted[1]];

    if (best >= 0.12 && best - second >= 0.06) {
      const [ax, ay, aw, ah] = corners[sorted[0]];
      if (!isAnchorOversized(img, bbox, sorted[0], ax, ay, aw, ah, threshold)) {
        return { found: true, position: sorted[0], reason: '', densities };
      }
    }

    const dStr = positions.map(p => `${p[0]}${p[4]}=${densities[p].toFixed(2)}`).join(' ');
    return { found: false, reason: `missing_corner_anchor(${dStr})`, densities };
  }

  if (hits.length > 1) {
    const sorted = [...hits].sort((a, b) => densities[b] - densities[a]);
    const gap = densities[sorted[0]] - densities[sorted[1]];
    if (gap < 0.10) {
      return { found: false, reason: 'multiple_anchor_candidates', densities };
    }
    return { found: true, position: sorted[0], reason: '', densities };
  }

  const anchorPos = hits[0];
  const [ax, ay, aw, ah] = corners[anchorPos];
  if (isAnchorOversized(img, bbox, anchorPos, ax, ay, aw, ah, threshold)) {
    return { found: false, reason: 'anchor_too_large', densities };
  }

  return { found: true, position: anchorPos, reason: '', densities };
}

function isAnchorOversized(
  img: ImageData,
  bbox: BBox,
  pos: AnchorPosition,
  cx: number,
  cy: number,
  cw: number,
  ch: number,
  threshold: number
): boolean {
  const span = Math.round(bbox.width * MAX_ANCHOR_SIDE_RATIO * 1.3);

  let probeX: number, probeY: number;
  switch (pos) {
    case 'top-left':
      probeX = cx + cw;
      probeY = cy + ch;
      break;
    case 'top-right':
      probeX = cx - span;
      probeY = cy + ch;
      break;
    case 'bottom-left':
      probeX = cx + cw;
      probeY = cy - span;
      break;
    case 'bottom-right':
      probeX = cx - span;
      probeY = cy - span;
      break;
  }

  probeX = Math.max(bbox.x, probeX);
  probeY = Math.max(bbox.y, probeY);
  const pw = Math.min(span, bbox.x + bbox.width - probeX);
  const ph = Math.min(span, bbox.y + bbox.height - probeY);

  if (pw <= 0 || ph <= 0) return false;

  return regionDensity(img, probeX, probeY, pw, ph, threshold) > 0.40;
}
