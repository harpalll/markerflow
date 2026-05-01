export type AnchorPosition = 'top-left' | 'top-right' | 'bottom-right' | 'bottom-left';

export interface BBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MarkerDebugInfo {
  borderDensity: { top: number; bottom: number; left: number; right: number };
  anchorDensities: Record<AnchorPosition, number>;
  innerDensity: number;
  centerDensity: number;
  squareRatio: number;
}

export type DetectionResult =
  | {
      ok: true;
      bbox: BBox;
      anchor: AnchorPosition;
      confidence: number;
      debug: MarkerDebugInfo;
    }
  | {
      ok: false;
      reason: string;
      debug?: Partial<MarkerDebugInfo>;
    };

export interface ProcessedMarker {
  id: string;
  uri: string;
  anchor: AnchorPosition;
  timestamp: number;
  confidence: number;
}

export interface ImageData {
  width: number;
  height: number;
  data: Uint8Array;
}
