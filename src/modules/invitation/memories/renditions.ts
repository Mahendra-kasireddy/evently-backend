import sharp from 'sharp';
import {
  DISPLAY_MAX_PX,
  DISPLAY_QUALITY,
  THUMBNAIL_MAX_PX,
  THUMBNAIL_QUALITY,
} from './memory.constants';

/**
 * The two smaller copies of a photograph that the gallery actually serves.
 *
 * A wedding gallery is thousands of 12-megapixel files. Putting the originals
 * into a two-column grid means a phone downloading tens of megabytes to draw
 * tiles a couple of hundred pixels wide — so the grid gets a thumbnail, the
 * viewer gets a display rendition, and the original is only ever fetched by
 * someone who asked to save it.
 *
 * Pure: buffers in, buffers out. Nothing here knows about storage, and nothing
 * here is ever called for a clip — pixels are all it can read, and a video's
 * are behind a decoder this service does not have.
 */

/**
 * Whether this file gets smaller copies at all.
 *
 * The whole guard against running an image pipeline over a video: a clip's
 * frames are behind a decoder this service does not have, and handing sharp a
 * 100MB MP4 would be a slow way to reach the same error. Asked of the declared
 * type, which the upload rules have already checked against the extension.
 */
export function isRenderableImage(mimeType: string): boolean {
  return ['image/jpeg', 'image/png', 'image/webp'].includes(mimeType);
}

export interface Rendition {
  buffer: Buffer;
  width: number;
  height: number;
  /** Always `image/webp`; named so callers do not assume. */
  contentType: string;
  extension: string;
}

/**
 * One smaller copy.
 *
 * `fit: 'inside'` with `withoutEnlargement` is what makes this safe on any
 * input: the aspect ratio is preserved, nothing is cropped, and a photograph
 * already smaller than the target is left at its own size rather than being
 * blown up into a soft version of itself.
 *
 * `rotate()` with no argument applies the EXIF orientation and then drops it,
 * so a portrait photograph off a phone is stored upright rather than relying
 * on every future reader to honour a tag. sharp writes no other metadata by
 * default, which takes the GPS coordinates of somebody's wedding out of a file
 * that is about to be shared with two hundred guests.
 */
async function render(buffer: Buffer, maxPx: number, quality: number): Promise<Rendition> {
  const { data, info } = await sharp(buffer)
    .rotate()
    .resize(maxPx, maxPx, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality })
    .toBuffer({ resolveWithObject: true });

  return {
    buffer: data,
    width: info.width,
    height: info.height,
    contentType: 'image/webp',
    extension: 'webp',
  };
}

/** The grid's copy. */
export function makeThumbnail(buffer: Buffer): Promise<Rendition> {
  return render(buffer, THUMBNAIL_MAX_PX, THUMBNAIL_QUALITY);
}

/** The viewer's copy. */
export function makeDisplay(buffer: Buffer): Promise<Rendition> {
  return render(buffer, DISPLAY_MAX_PX, DISPLAY_QUALITY);
}

export interface Renditions {
  thumbnail: Rendition;
  display: Rendition;
}

/**
 * Both copies, or a rejection naming what went wrong.
 *
 * Deliberately not swallowing the error here: whether a failed rendition
 * should sink an upload is the caller's decision, and the caller's answer is
 * no — the original is already safely stored by then, so the gallery falls
 * back to it and the failure is logged rather than being lost in a `catch {}`
 * three files away from anyone who could act on it.
 */
export async function makeRenditions(buffer: Buffer): Promise<Renditions> {
  const [thumbnail, display] = await Promise.all([makeThumbnail(buffer), makeDisplay(buffer)]);
  return { thumbnail, display };
}
