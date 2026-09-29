/**
 * The two smaller copies the gallery actually serves.
 *
 * The failure this guards against is a performance one and therefore invisible
 * in review: everything works, and a phone quietly pulls forty megabytes to
 * draw six tiles. So the assertions are about size and shape, not about the
 * pictures looking right.
 */

import sharp from 'sharp';
import { isRenderableImage, makeDisplay, makeRenditions, makeThumbnail } from './renditions';
import { DISPLAY_MAX_PX, THUMBNAIL_MAX_PX } from './memory.constants';

/** A photograph-shaped JPEG of a given size, with enough detail to compress. */
async function photo(width: number, height: number): Promise<Buffer> {
  const px = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 3;
      px[i] = (x * 7) % 256;
      px[i + 1] = (y * 5) % 256;
      px[i + 2] = ((x + y) * 3) % 256;
    }
  }
  return sharp(px, { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 92 })
    .toBuffer();
}

const meta = (buffer: Buffer) => sharp(buffer).metadata();

describe('the thumbnail', () => {
  it('fits a landscape photograph inside the box without distorting it', async () => {
    const original = await photo(4000, 3000);
    const thumb = await makeThumbnail(original);
    expect(Math.max(thumb.width, thumb.height)).toBe(THUMBNAIL_MAX_PX);
    // 4:3 in, 4:3 out. A squashed thumbnail is worse than a large one.
    expect(thumb.width / thumb.height).toBeCloseTo(4 / 3, 2);
  });

  it('fits a portrait photograph the same way', async () => {
    const thumb = await makeThumbnail(await photo(3000, 4000));
    expect(Math.max(thumb.width, thumb.height)).toBe(THUMBNAIL_MAX_PX);
    expect(thumb.height).toBeGreaterThan(thumb.width);
    expect(thumb.width / thumb.height).toBeCloseTo(3 / 4, 2);
  });

  it('does not crop — every pixel of the frame survives', async () => {
    // A square crop is a reliable way to remove somebody's head from a
    // wedding photograph, so the whole frame is kept and fitted.
    const thumb = await makeThumbnail(await photo(4000, 1000));
    expect(thumb.width / thumb.height).toBeCloseTo(4, 1);
  });

  it('leaves a photograph already smaller than the box at its own size', async () => {
    const thumb = await makeThumbnail(await photo(320, 240));
    expect(thumb.width).toBe(320);
    expect(thumb.height).toBe(240);
  });

  it('is WebP, and dramatically smaller than the original', async () => {
    const original = await photo(4000, 3000);
    const thumb = await makeThumbnail(original);
    expect(thumb.contentType).toBe('image/webp');
    expect((await meta(thumb.buffer)).format).toBe('webp');
    expect(thumb.buffer.length).toBeLessThan(original.length / 10);
  });
});

describe('the display rendition', () => {
  it('is bounded by its own, larger box', async () => {
    const display = await makeDisplay(await photo(4000, 3000));
    expect(Math.max(display.width, display.height)).toBe(DISPLAY_MAX_PX);
  });

  it('is bigger than the thumbnail and smaller than the original', async () => {
    const original = await photo(4000, 3000);
    const { thumbnail, display } = await makeRenditions(original);
    expect(display.buffer.length).toBeGreaterThan(thumbnail.buffer.length);
    expect(display.buffer.length).toBeLessThan(original.length);
  });
});

describe('orientation and metadata', () => {
  it('stores a rotated photograph upright rather than trusting the tag', async () => {
    /*
     * A phone writes the sensor's pixels and an EXIF orientation of 6 meaning
     * "turn this". Honoured at render time, so the stored file needs no reader
     * to cooperate — and a reader that ignores EXIF no longer shows it sideways.
     */
    const sideways = await sharp(await photo(400, 800))
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
    expect((await meta(sideways)).orientation).toBe(6);

    const thumb = await makeThumbnail(sideways);
    // Turned: the tall frame comes out wide, and carries no orientation tag.
    expect(thumb.width).toBeGreaterThan(thumb.height);
    expect((await meta(thumb.buffer)).orientation).toBeUndefined();
  });

  it('carries no EXIF through — including where the photograph was taken', async () => {
    // Two hundred guests are about to be able to open this file.
    const withGps = await sharp(await photo(600, 400))
      .withExif({ IFD0: { Copyright: 'Someone' }, GPS: { GPSLatitudeRef: 'N' } })
      .jpeg()
      .toBuffer();
    const thumb = await makeThumbnail(withGps);
    const out = await meta(thumb.buffer);
    expect(out.exif).toBeUndefined();
  });
});

describe('what gets renditions at all', () => {
  it('renders the image types the upload rules accept', () => {
    expect(isRenderableImage('image/jpeg')).toBe(true);
    expect(isRenderableImage('image/png')).toBe(true);
    expect(isRenderableImage('image/webp')).toBe(true);
  });

  it('never renders a video or a reel', () => {
    /*
     * The guard that keeps sharp away from clips. Both kinds are the same
     * files to this check — a reel is a video with a tag — so neither can
     * reach the image pipeline.
     */
    expect(isRenderableImage('video/mp4')).toBe(false);
    expect(isRenderableImage('video/webm')).toBe(false);
    expect(isRenderableImage('video/quicktime')).toBe(false);
  });

  it('refuses anything it was not told about', () => {
    expect(isRenderableImage('application/pdf')).toBe(false);
    expect(isRenderableImage('image/svg+xml')).toBe(false);
    expect(isRenderableImage('')).toBe(false);
  });
});

describe('when it cannot be done', () => {
  it('rejects on a file that is not an image, rather than returning nothing', async () => {
    /*
     * The caller's job, not this module's: by the time renditions run the
     * original is already stored, so the upload survives and the record is
     * marked failed. Swallowing it here would hide that from the log.
     */
    await expect(makeThumbnail(Buffer.from('this is not a photograph'))).rejects.toThrow();
    await expect(makeRenditions(Buffer.alloc(64))).rejects.toThrow();
  });

  it('rejects on a truncated image', async () => {
    const original = await photo(800, 600);
    await expect(makeThumbnail(original.subarray(0, 64))).rejects.toThrow();
  });
});
