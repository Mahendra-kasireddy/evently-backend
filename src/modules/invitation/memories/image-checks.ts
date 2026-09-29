import sharp from 'sharp';
import {
  ANALYSIS_SIZE,
  BLUR_MIN_VARIANCE,
  DARK_MIN_LUMA,
  DUPLICATE_HAMMING_MAX,
} from './memory.constants';

/**
 * What a photograph is, measured.
 *
 * Three long-standing measurements over the pixels, not a model: a difference
 * hash for "is this the same picture", the variance of the Laplacian for "is
 * this in focus", and the mean luminance for "can anything be seen". All three
 * run on a 256px grayscale copy, which is all any of them need — working at
 * full resolution costs time and changes no answer.
 */

export interface ImageAnalysis {
  /** 64-bit difference hash, as 16 hex characters. */
  hash: string;
  /** Variance of the Laplacian. Higher is sharper. */
  sharpness: number;
  /** Mean luminance, 0–255. */
  luma: number;
  blurry: boolean;
  dark: boolean;
}

/**
 * Grayscale pixels at a given size, as one byte per pixel.
 *
 * `stretch` pulls the darkest and lightest pixels out to the full range before
 * reading. Focus is measured on a stretched copy and brightness on the
 * original — see `analyseImage` for why that distinction is load-bearing.
 */
async function grayscale(
  buffer: Buffer,
  width: number,
  height: number,
  stretch = false,
): Promise<Uint8Array> {
  const pipeline = sharp(buffer)
    .rotate() /* Honour EXIF orientation, so a phone photo is not analysed sideways. */
    .removeAlpha()
    .greyscale();
  const { data } = await (stretch ? pipeline.normalise() : pipeline)
    .resize(width, height, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

/**
 * The difference hash: is each pixel brighter than the one to its right?
 *
 * 9×8 grayscale gives 8 comparisons per row and 64 bits in all. Chosen over an
 * average hash because it describes gradients rather than absolute brightness,
 * so the same photograph re-saved darker by another app still matches — which
 * is exactly the duplicate a shared gallery collects.
 */
export async function differenceHash(buffer: Buffer): Promise<string> {
  const px = await grayscale(buffer, 9, 8);
  let bits = '';
  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      bits += (px[row * 9 + col] ?? 0) > (px[row * 9 + col + 1] ?? 0) ? '1' : '0';
    }
  }
  /* Hex, so it stores and indexes as a short string rather than 64 booleans. */
  let hex = '';
  for (let i = 0; i < 64; i += 4) {
    hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  }
  return hex;
}

/** How many of the 64 bits differ. 0 is the same picture. */
export function hammingDistance(a: string, b: string): number {
  if (!a || !b || a.length !== b.length) return 64;
  let distance = 0;
  for (let i = 0; i < a.length; i += 1) {
    const diff = parseInt(a[i]!, 16) ^ parseInt(b[i]!, 16);
    /* Four bits per hex digit; counted rather than looked up because 16
       entries of table are not worth the indirection. */
    distance += ((diff >> 3) & 1) + ((diff >> 2) & 1) + ((diff >> 1) & 1) + (diff & 1);
  }
  return distance;
}

/** True when the second picture is the first one again. */
export function isNearDuplicate(a: string, b: string): boolean {
  return hammingDistance(a, b) <= DUPLICATE_HAMMING_MAX;
}

/**
 * Sharpness, as the variance of the Laplacian.
 *
 * The Laplacian is the second derivative — it answers "how fast is brightness
 * changing, changing". An in-focus edge is a step and produces a large
 * response; a blurred one is a ramp and produces almost none. So the spread of
 * those responses across the picture collapses as focus goes, and the spread
 * is the number.
 */
function laplacianVariance(px: Uint8Array, width: number, height: number): number {
  const responses: number[] = [];
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      const value =
        4 * (px[i] ?? 0) -
        (px[i - 1] ?? 0) -
        (px[i + 1] ?? 0) -
        (px[i - width] ?? 0) -
        (px[i + width] ?? 0);
      responses.push(value);
    }
  }
  if (responses.length === 0) return 0;
  const mean = responses.reduce((sum, v) => sum + v, 0) / responses.length;
  return responses.reduce((sum, v) => sum + (v - mean) ** 2, 0) / responses.length;
}

/**
 * Everything the gallery wants to know about one photograph.
 *
 * Focus is measured on a contrast-stretched copy and brightness on the
 * original, because the Laplacian's amplitude scales with the picture's own.
 * Halving every pixel quarters the variance, so without the stretch a sharp
 * photograph taken at night measures as badly out of focus — every dark
 * picture would carry both warnings, and the one about focus would be wrong.
 * Stretching first asks the question that was meant: given what can be seen
 * here, are the edges edges?
 */
export async function analyseImage(buffer: Buffer): Promise<ImageAnalysis> {
  const size = ANALYSIS_SIZE;
  const [hash, px, stretched] = await Promise.all([
    differenceHash(buffer),
    grayscale(buffer, size, size),
    grayscale(buffer, size, size, true),
  ]);

  const sharpness = laplacianVariance(stretched, size, size);
  const luma = px.reduce((sum, v) => sum + v, 0) / (px.length || 1);

  return {
    hash,
    sharpness,
    luma,
    blurry: sharpness < BLUR_MIN_VARIANCE,
    dark: luma < DARK_MIN_LUMA,
  };
}
