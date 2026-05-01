import { Buffer } from 'buffer';
import * as jpeg from 'jpeg-js';
import type { ImageData } from '../../types/marker';

export function decodeJpegFromBase64(base64: string): ImageData {
  const buf = Buffer.from(base64, 'base64');
  const decoded = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true });

  return {
    width: decoded.width,
    height: decoded.height,
    data: decoded.data as unknown as Uint8Array,
  };
}
