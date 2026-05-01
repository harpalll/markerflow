import type { ImageData, BBox, DetectionResult, AnchorPosition, MarkerDebugInfo } from '../../types/marker';
import { grayAt, regionDensity } from '../image/pixelUtils';
import {
  BLACK_THRESHOLD,
  MIN_BORDER_DENSITY,
  BORDER_BAND,
  BORDER_EXCLUSION,
  ANCHOR_ZONE_START,
  ANCHOR_ZONE_END,
  MIN_ANCHOR_SIDE,
  MAX_ANCHOR_SIDE,
  MIN_ANCHOR_AREA_RATIO,
  MAX_ANCHOR_AREA_RATIO,
  MIN_ANCHOR_ASPECT,
  MAX_ANCHOR_ASPECT,
  CENTER_ZONE_START,
  CENTER_ZONE_END,
  INNER_ZONE_START,
  INNER_ZONE_END,
  MAX_CENTER_DENSITY,
  MAX_INNER_DENSITY,
  MAX_INTERNAL_COMPONENT_SIDE,
} from '../../constants/scanner';

interface Component {
  x: number;
  y: number;
  width: number;
  height: number;
  area: number;
  centroidX: number;
  centroidY: number;
}

/**
 * Validate that a candidate bounding box actually contains Marker 1.
 *
 * Pipeline:
 * 1. Validate border density
 * 2. Find internal connected black components (excluding border)
 * 3. Reject oversized corner blocks
 * 4. Reject high center density
 * 5. Reject large non-corner internal blocks
 * 6. Find exactly one valid small anchor in a corner zone
 * 7. Check inner density excluding anchor
 */
export function validateMarker1(
  img: ImageData,
  bbox: BBox,
  threshold = BLACK_THRESHOLD
): DetectionResult {
  const { x, y, width: bw, height: bh } = bbox;
  const side = Math.min(bw, bh);

  // --- 1. Border validation ---
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

  // --- 2. Center danger zone density check ---
  const czStart = Math.round(side * CENTER_ZONE_START);
  const czEnd = Math.round(side * CENTER_ZONE_END);
  const czSize = czEnd - czStart;
  const centerD = regionDensity(
    img,
    x + Math.round(bw * CENTER_ZONE_START),
    y + Math.round(bh * CENTER_ZONE_START),
    Math.round(bw * (CENTER_ZONE_END - CENTER_ZONE_START)),
    Math.round(bh * (CENTER_ZONE_END - CENTER_ZONE_START)),
    threshold
  );

  if (centerD > MAX_CENTER_DENSITY) {
    return {
      ok: false,
      reason: 'center_black_density_too_high',
      debug: { borderDensity, centerDensity: centerD, squareRatio: bw / bh } as any,
    };
  }

  // --- 3. Find internal connected black components ---
  const excl = Math.round(side * BORDER_EXCLUSION);
  const interiorX = x + excl;
  const interiorY = y + excl;
  const interiorW = bw - 2 * excl;
  const interiorH = bh - 2 * excl;

  const components = findBlackComponents(img, interiorX, interiorY, interiorW, interiorH, threshold);

  // --- 4. Classify components ---
  const anchorZoneStartPx = Math.round(side * ANCHOR_ZONE_START);
  const anchorZoneEndPx = Math.round(side * ANCHOR_ZONE_END);
  const minAnchorSide = Math.round(side * MIN_ANCHOR_SIDE);
  const maxAnchorSide = Math.round(side * MAX_ANCHOR_SIDE);
  const markerArea = bw * bh;
  const maxInternalSide = Math.round(side * MAX_INTERNAL_COMPONENT_SIDE);

  // check for oversized corner blocks (anchor_too_large)
  for (const comp of components) {
    const zone = getAnchorZone(comp, bbox, anchorZoneStartPx, anchorZoneEndPx);
    if (zone && Math.max(comp.width, comp.height) > maxAnchorSide) {
      return {
        ok: false,
        reason: 'anchor_too_large',
        debug: {
          borderDensity,
          centerDensity: centerD,
          componentSize: `${comp.width}x${comp.height}`,
          squareRatio: bw / bh,
        } as any,
      };
    }
  }

  // check for large non-corner internal blocks
  for (const comp of components) {
    const zone = getAnchorZone(comp, bbox, anchorZoneStartPx, anchorZoneEndPx);
    if (!zone && Math.max(comp.width, comp.height) > maxInternalSide) {
      return {
        ok: false,
        reason: 'invalid_large_black_block',
        debug: {
          borderDensity,
          centerDensity: centerD,
          componentSize: `${comp.width}x${comp.height}`,
          squareRatio: bw / bh,
        } as any,
      };
    }
  }

  // --- 5. Find valid anchor components ---
  const validAnchors: { comp: Component; zone: AnchorPosition }[] = [];

  for (const comp of components) {
    const zone = getAnchorZone(comp, bbox, anchorZoneStartPx, anchorZoneEndPx);
    if (!zone) continue;

    const aspect = comp.width / comp.height;
    if (aspect < MIN_ANCHOR_ASPECT || aspect > MAX_ANCHOR_ASPECT) continue;

    const compSide = Math.max(comp.width, comp.height);
    if (compSide < minAnchorSide || compSide > maxAnchorSide) continue;

    const areaRatio = comp.area / markerArea;
    if (areaRatio < MIN_ANCHOR_AREA_RATIO || areaRatio > MAX_ANCHOR_AREA_RATIO) continue;

    validAnchors.push({ comp, zone });
  }

  if (validAnchors.length === 0) {
    // try relaxed: if there's a component in a corner zone with reasonable density
    // this handles camera captures where anchor isn't perfectly rectangular
    const relaxed = findRelaxedAnchor(components, bbox, anchorZoneStartPx, anchorZoneEndPx, minAnchorSide, maxAnchorSide, markerArea);
    if (relaxed) {
      validAnchors.push(relaxed);
    }
  }

  if (validAnchors.length === 0) {
    return {
      ok: false,
      reason: 'missing_valid_corner_anchor',
      debug: {
        borderDensity,
        centerDensity: centerD,
        totalComponents: components.length,
        squareRatio: bw / bh,
      } as any,
    };
  }

  if (validAnchors.length > 1) {
    // pick the one with highest area ratio (most anchor-like)
    validAnchors.sort((a, b) => b.comp.area - a.comp.area);
    const best = validAnchors[0];
    const second = validAnchors[1];
    // if they're too close in size, reject as ambiguous
    if (second.comp.area > best.comp.area * 0.7) {
      return {
        ok: false,
        reason: 'multiple_anchor_candidates',
        debug: { borderDensity, centerDensity: centerD, squareRatio: bw / bh } as any,
      };
    }
  }

  const anchor = validAnchors[0];

  // --- 6. Broad inner density check (excluding anchor area) ---
  const innerStartX = x + Math.round(bw * INNER_ZONE_START);
  const innerStartY = y + Math.round(bh * INNER_ZONE_START);
  const innerW = Math.round(bw * (INNER_ZONE_END - INNER_ZONE_START));
  const innerH = Math.round(bh * (INNER_ZONE_END - INNER_ZONE_START));
  const innerD = regionDensity(img, innerStartX, innerStartY, innerW, innerH, threshold);

  // subtract approximate anchor contribution
  const anchorContrib = anchor.comp.area / (innerW * innerH);
  const adjustedInnerD = Math.max(0, innerD - anchorContrib);

  if (adjustedInnerD > MAX_INNER_DENSITY) {
    return {
      ok: false,
      reason: 'inner_black_density_too_high',
      debug: {
        borderDensity,
        centerDensity: centerD,
        innerDensity: adjustedInnerD,
        squareRatio: bw / bh,
      } as any,
    };
  }

  // --- 7. Success ---
  const debug: MarkerDebugInfo = {
    borderDensity,
    anchorDensities: {
      'top-left': 0, 'top-right': 0, 'bottom-left': 0, 'bottom-right': 0,
      [anchor.zone]: anchor.comp.area / (anchor.comp.width * anchor.comp.height),
    },
    innerDensity: adjustedInnerD,
    centerDensity: centerD,
    squareRatio: bw / bh,
  };

  const avgBorder = (topD + bottomD + leftD + rightD) / 4;
  const confidence = avgBorder * 0.4
    + (anchor.comp.area / markerArea) * 8 // normalize to ~0.3
    + (1 - adjustedInnerD) * 0.3;

  return {
    ok: true,
    bbox,
    anchor: anchor.zone,
    confidence: Math.min(1, confidence),
    debug,
  };
}

/**
 * Determine which anchor zone a component's centroid falls into.
 * Returns null if not in any valid corner anchor zone.
 */
function getAnchorZone(
  comp: Component,
  bbox: BBox,
  zoneStartPx: number,
  zoneEndPx: number,
): AnchorPosition | null {
  // component centroid relative to bbox origin
  const relCx = comp.centroidX - bbox.x;
  const relCy = comp.centroidY - bbox.y;

  const inLeft = relCx >= zoneStartPx && relCx <= zoneEndPx;
  const inRight = relCx >= (bbox.width - zoneEndPx) && relCx <= (bbox.width - zoneStartPx);
  const inTop = relCy >= zoneStartPx && relCy <= zoneEndPx;
  const inBottom = relCy >= (bbox.height - zoneEndPx) && relCy <= (bbox.height - zoneStartPx);

  if (inTop && inLeft) return 'top-left';
  if (inTop && inRight) return 'top-right';
  if (inBottom && inLeft) return 'bottom-left';
  if (inBottom && inRight) return 'bottom-right';

  return null;
}

/**
 * Relaxed anchor search for camera captures where the anchor component
 * might not be perfectly rectangular (due to blur, noise, lighting).
 * Still requires the component to be in a corner zone and reasonably sized.
 */
function findRelaxedAnchor(
  components: Component[],
  bbox: BBox,
  zoneStartPx: number,
  zoneEndPx: number,
  minSide: number,
  maxSide: number,
  markerArea: number,
): { comp: Component; zone: AnchorPosition } | null {
  const candidates: { comp: Component; zone: AnchorPosition; score: number }[] = [];

  for (const comp of components) {
    const zone = getAnchorZone(comp, bbox, zoneStartPx, zoneEndPx);
    if (!zone) continue;

    const compSide = Math.max(comp.width, comp.height);
    // relaxed size: allow slightly smaller (camera blur fragments)
    if (compSide < minSide * 0.6) continue;
    if (compSide > maxSide) continue;

    const areaRatio = comp.area / markerArea;
    if (areaRatio < MIN_ANCHOR_AREA_RATIO * 0.5) continue;
    if (areaRatio > MAX_ANCHOR_AREA_RATIO * 1.3) continue;

    // score by how anchor-like it is
    const aspectScore = 1 - Math.abs(1 - comp.width / comp.height);
    const sizeScore = areaRatio / MAX_ANCHOR_AREA_RATIO;
    candidates.push({ comp, zone, score: aspectScore * 0.5 + sizeScore * 0.5 });
  }

  if (candidates.length === 0) return null;
  if (candidates.length > 1) {
    candidates.sort((a, b) => b.score - a.score);
    // if top two are too close and in different zones, ambiguous
    if (candidates[1].score > candidates[0].score * 0.8 && candidates[0].zone !== candidates[1].zone) {
      return null;
    }
  }

  return { comp: candidates[0].comp, zone: candidates[0].zone };
}

/**
 * Find connected black components inside a region using flood fill.
 * Only returns components above a minimum size threshold.
 */
function findBlackComponents(
  img: ImageData,
  rx: number,
  ry: number,
  rw: number,
  rh: number,
  threshold: number
): Component[] {
  const minArea = Math.round(rw * rh * 0.003); // ignore tiny noise

  // build binary grid for the interior region
  const visited = new Uint8Array(rw * rh);
  const components: Component[] = [];

  for (let row = 0; row < rh; row++) {
    for (let col = 0; col < rw; col++) {
      const idx = row * rw + col;
      if (visited[idx]) continue;

      const px = rx + col;
      const py = ry + row;
      if (px >= img.width || py >= img.height) continue;
      if (grayAt(img, px, py) >= threshold) continue;

      // flood fill this component
      let minC = col, maxC = col, minR = row, maxR = row;
      let area = 0;
      let sumX = 0, sumY = 0;
      const stack = [idx];
      visited[idx] = 1;

      while (stack.length > 0) {
        const cur = stack.pop()!;
        const cr = Math.floor(cur / rw);
        const cc = cur % rw;

        area++;
        sumX += cc;
        sumY += cr;
        if (cc < minC) minC = cc;
        if (cc > maxC) maxC = cc;
        if (cr < minR) minR = cr;
        if (cr > maxR) maxR = cr;

        // 4-connected neighbors (sufficient for solid blocks)
        const neighbors = [
          cr > 0 ? (cr - 1) * rw + cc : -1,
          cr < rh - 1 ? (cr + 1) * rw + cc : -1,
          cc > 0 ? cr * rw + (cc - 1) : -1,
          cc < rw - 1 ? cr * rw + (cc + 1) : -1,
        ];

        for (const n of neighbors) {
          if (n < 0 || visited[n]) continue;
          const nr = Math.floor(n / rw);
          const nc = n % rw;
          const npx = rx + nc;
          const npy = ry + nr;
          if (npx >= img.width || npy >= img.height) continue;
          if (grayAt(img, npx, npy) >= threshold) continue;
          visited[n] = 1;
          stack.push(n);
        }
      }

      if (area < minArea) continue;

      components.push({
        x: rx + minC,
        y: ry + minR,
        width: maxC - minC + 1,
        height: maxR - minR + 1,
        area,
        centroidX: rx + Math.round(sumX / area),
        centroidY: ry + Math.round(sumY / area),
      });
    }
  }

  return components;
}
