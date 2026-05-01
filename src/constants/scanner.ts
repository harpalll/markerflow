// grayscale threshold — pixels darker than this count as "black"
export const BLACK_THRESHOLD = 110;

// candidate bounding box must be roughly square
export const MIN_SQUARE_RATIO = 0.80;
export const MAX_SQUARE_RATIO = 1.20;

// each border band must have at least this much black
export const MIN_BORDER_DENSITY = 0.42;

// the single corner anchor region
export const MIN_ANCHOR_DENSITY = 0.18;
export const MIN_ANCHOR_SIDE_RATIO = 0.10;
export const MAX_ANCHOR_SIDE_RATIO = 0.25;

// reject if center or inner area is too dark
export const MAX_CENTER_DENSITY = 0.20;
export const MAX_INNER_DENSITY = 0.35;

// border band thickness as fraction of marker side
export const BORDER_BAND = 0.13;

// anchor region inset from border edge
export const ANCHOR_INSET_START = 0.14;
export const ANCHOR_INSET_END = 0.36;

// scanning config
export const SCAN_INTERVAL_MS = 600;
export const CAPTURE_QUALITY = 0.5;
export const DETECTION_DOWNSCALE = 500;
export const REQUIRED_MARKERS = 20;
export const OUTPUT_SIZE = 300;
