import type { AnchorPosition } from '../../types/marker';

/**
 * How many degrees clockwise to rotate the extracted marker
 * so the anchor ends up in the canonical top-left position.
 */
export function rotationForAnchor(anchor: AnchorPosition): number {
  switch (anchor) {
    case 'top-left': return 0;
    case 'top-right': return 270;
    case 'bottom-right': return 180;
    case 'bottom-left': return 90;
  }
}
