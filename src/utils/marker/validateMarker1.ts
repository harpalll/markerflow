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
 * Validate that a candidate bounding box actually contains Marker 1:
 *  1. Thick black border on all 4 sides
 *  2. Mostly empty inner area
 *  3. Exactly one small black square in a corner (the anchor)
 *  4. Center is not filled
 */
export function validateMarker1(img: ImageData, bbox: BBox): DetectionResult {
  const { x, y, width: bw, height: bh } = bbox;
  const borderW = Math.round(bw * BORDER_BAND);
  const borderH = Math.round(bh * BORDER_BAND);

  const topD = regionDensity(img, x, y, bw, borderH);
  const bottomD = regionDensity(img, x, y + bh - borderH, bw, borderH);
  const leftD = regionDensity(img, x, y, borderW, bh);
  const rightD = regionDensity(img, x + bw - borderW, y, borderW, bh);

  const borderDensity = { top: topD, bottom: bottomD, left: leftD, right: rightD };

  // all 4 borders must be solid black
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
  const innerD = regionDensity(img, innerX, innerY, innerW, innerH);

  if (innerD > MAX_INNER_DENSITY) {
    return {
      ok: false,
      reason: 'inner_black_density_too_high',
      debug: { borderDensity, innerDensity: innerD, squareRatio: bw / bh } as any,
    };
  }

  // center region — should be nearly empty
  const cx = x + Math.round(bw * 0.35);
  const cy = y + Math.round(bh * 0.35);
  const cw = Math.round(bw * 0.30);
  const ch = Math.round(bh * 0.30);
  const centerD = regionDensity(img, cx, cy, cw, ch);

  if (centerD > MAX_CENTER_DENSITY) {
    return {
      ok: false,
      reason: 'center_black_density_too_high',
      debug: { borderDensity, innerDensity: innerD, centerDensity: centerD, squareRatio: bw / bh } as any,
    };
  }

  // anchor detection — check all 4 inner corners
  const anchorResult = findAnchor(img, bbox);
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

  // confidence = average of border densities + anchor strength
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

/**
 * Look for the small filled square in exactly one of the four inner corners.
 * The anchor sits just inside the border — not touching the outer edge,
 * not in the center.
 */
function findAnchor(img: ImageData, bbox: BBox): AnchorResult {
  const { x, y, width: bw, height: bh } = bbox;
  const s0 = ANCHOR_INSET_START;
  const s1 = ANCHOR_INSET_END;

  // each corner region is a small square inside the border
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
    densities[pos] = regionDensity(img, rx, ry, rw, rh);
  }

  // find corners with enough black to be an anchor
  const hits = positions.filter(p => densities[p] >= MIN_ANCHOR_DENSITY);

  if (hits.length === 0) {
    return { found: false, reason: 'missing_corner_anchor', densities };
  }

  if (hits.length > 1) {
    // if multiple corners are dark, check if one is clearly dominant
    const sorted = [...hits].sort((a, b) => densities[b] - densities[a]);
    const gap = densities[sorted[0]] - densities[sorted[1]];
    if (gap < 0.10) {
      return { found: false, reason: 'multiple_anchor_candidates', densities };
    }
    // one is clearly stronger — use it
    return { found: true, position: sorted[0], reason: '', densities };
  }

  // validate the anchor isn't too large (catches TestImage4 — oversized block)
  const anchorPos = hits[0];
  const [ax, ay, aw, ah] = corners[anchorPos];
  const anchorSize = checkAnchorSize(img, bbox, ax, ay, aw, ah);
  if (anchorSize === 'too_large') {
    return { found: false, reason: 'anchor_too_large', densities };
  }

  return { found: true, position: anchorPos, reason: '', densities };
}

/**
 * Verify the dense black region in the anchor corner isn't oversized.
 * A valid Marker 1 anchor is small — roughly 10-22% of marker side.
 * If the black blob extends much further, it's an incorrect marker.
 */
function checkAnchorSize(
  img: ImageData,
  bbox: BBox,
  cornerX: number,
  cornerY: number,
  cornerW: number,
  cornerH: number
): 'ok' | 'too_large' {
  // expand the search area beyond the corner region
  const expandedW = Math.round(bbox.width * MAX_ANCHOR_SIDE_RATIO * 1.5);
  const expandedH = Math.round(bbox.height * MAX_ANCHOR_SIDE_RATIO * 1.5);

  // check the area just outside the expected anchor zone
  // if it's also heavily black, the "anchor" is actually a large block
  const outerX = cornerX + cornerW;
  const outerY = cornerY + cornerH;
  const outerW = Math.min(expandedW, bbox.x + bbox.width - outerX);
  const outerH = Math.min(expandedH, bbox.y + bbox.height - outerY);

  if (outerW <= 0 || outerH <= 0) return 'ok';

  const outerDensity = regionDensity(img, outerX, outerY, outerW, outerH);

  // if the area adjacent to the anchor is also very dark, the block is too big
  if (outerDensity > 0.40) {
    return 'too_large';
  }

  return 'ok';
}
