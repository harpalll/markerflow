// grayscale threshold — pixels darker than this count as "black"
export const BLACK_THRESHOLD = 110;

// candidate bounding box must be roughly square
export const MIN_SQUARE_RATIO = 0.80;
export const MAX_SQUARE_RATIO = 1.20;

// each border band must have at least this much black
export const MIN_BORDER_DENSITY = 0.42;

// border band thickness as fraction of marker side
export const BORDER_BAND = 0.117;

// border exclusion zone for interior analysis (fraction of side)
// must be larger than actual border width to avoid border pixel leakage
export const BORDER_EXCLUSION = 0.14;

// anchor zone bounds (fraction of marker side, measured from edge)
export const ANCHOR_ZONE_START = 0.117;
export const ANCHOR_ZONE_END = 0.317;

// anchor component size constraints (fraction of marker side)
export const MIN_ANCHOR_SIDE = 0.083;
export const MAX_ANCHOR_SIDE = 0.193;

// anchor area as fraction of total marker area
export const MIN_ANCHOR_AREA_RATIO = 0.008;
export const MAX_ANCHOR_AREA_RATIO = 0.045;

// anchor shape constraint
export const MIN_ANCHOR_ASPECT = 0.75;
export const MAX_ANCHOR_ASPECT = 1.25;

// center danger zone (fraction of side, measured from edge)
export const CENTER_ZONE_START = 0.35;
export const CENTER_ZONE_END = 0.65;

// broad inner danger zone
export const INNER_ZONE_START = 0.25;
export const INNER_ZONE_END = 0.75;

// density rejection thresholds
export const MAX_CENTER_DENSITY = 0.12;
export const MAX_INNER_DENSITY = 0.18;

// max size of any internal non-anchor component (fraction of side)
export const MAX_INTERNAL_COMPONENT_SIDE = 0.217;

// scanning config
export const SCAN_INTERVAL_MS = 600;
export const CAPTURE_QUALITY = 0.5;
export const DETECTION_DOWNSCALE = 500;
export const REQUIRED_MARKERS = 20;
export const OUTPUT_SIZE = 300;
