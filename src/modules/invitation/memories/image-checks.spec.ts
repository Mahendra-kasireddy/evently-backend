/**
 * The three measurements, against pictures actually made for the purpose.
 *
 * Generated rather than fixtures: a checked-in JPEG proves the numbers on one
 * photograph, while building a sharp one and then blurring *that same one*
 * proves the measurement responds to the thing it claims to measure. The
 * thresholds are judgement calls; that they sit on the right side of a clearly
 * sharp and a clearly blurred image is not.
 */

import sharp from 'sharp';
import { analyseImage, differenceHash, hammingDistance, isNearDuplicate } from './image-checks';
import { BLUR_MIN_VARIANCE, DARK_MIN_LUMA } from './memory.constants';

/** A busy, high-contrast picture: plenty of edges for focus to act on. */
async function checkerboard(size = 320, squares = 8, light = 235, dark = 20) {
  const px = Buffer.alloc(size * size * 3);
  const cell = size / squares;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const on = (Math.floor(x / cell) + Math.floor(y / cell)) % 2 === 0;
      const v = on ? light : dark;
      const i = (y * size + x) * 3;
      px[i] = v;
      px[i + 1] = v;
      px[i + 2] = v;
    }
  }
  return sharp(px, { raw: { width: size, height: size, channels: 3 } })
    .jpeg({ quality: 92 })
    .toBuffer();
}

const blurred = (buffer: Buffer, sigma = 8) =>
  sharp(buffer).blur(sigma).jpeg({ quality: 92 }).toBuffer();

const darkened = (buffer: Buffer) => sharp(buffer).linear(0.06, 0).jpeg({ quality: 92 }).toBuffer();

describe('is it the same picture', () => {
  it('gives the same hash for the same image', async () => {
    const a = await checkerboard();
    expect(await differenceHash(a)).toBe(await differenceHash(a));
  });

  it('matches the same photograph re-saved at another quality', async () => {
    // The duplicate a shared gallery actually collects: one guest's phone and
    // the copy their messaging app compressed.
    const a = await checkerboard();
    const b = await sharp(a).jpeg({ quality: 40 }).toBuffer();
    expect(isNearDuplicate(await differenceHash(a), await differenceHash(b))).toBe(true);
  });

  it('matches the same photograph saved darker', async () => {
    // A difference hash describes gradients, so overall brightness moving does
    // not change it — which is the reason it was chosen over an average hash.
    const a = await checkerboard();
    const b = await sharp(a).modulate({ brightness: 0.75 }).jpeg().toBuffer();
    expect(isNearDuplicate(await differenceHash(a), await differenceHash(b))).toBe(true);
  });

  it('does not match two different pictures', async () => {
    const a = await checkerboard(320, 8);
    const b = await checkerboard(320, 3);
    expect(isNearDuplicate(await differenceHash(a), await differenceHash(b))).toBe(false);
  });

  it('treats a missing or malformed hash as maximally distant', () => {
    expect(hammingDistance('', 'abcdef0123456789')).toBe(64);
    expect(hammingDistance('abc', 'abcdef0123456789')).toBe(64);
  });
});

describe('is it in focus', () => {
  it('scores a sharp picture well above the threshold', async () => {
    const sharpOne = await checkerboard();
    const { sharpness, blurry } = await analyseImage(sharpOne);
    expect(sharpness).toBeGreaterThan(BLUR_MIN_VARIANCE);
    expect(blurry).toBe(false);
  });

  it('scores that same picture, blurred, well below it', async () => {
    const buffer = await blurred(await checkerboard());
    const { sharpness, blurry } = await analyseImage(buffer);
    expect(sharpness).toBeLessThan(BLUR_MIN_VARIANCE);
    expect(blurry).toBe(true);
  });

  it('falls as blur rises, rather than flipping at one point', async () => {
    const base = await checkerboard();
    const scores = [] as number[];
    for (const sigma of [1, 4, 12]) {
      scores.push((await analyseImage(await blurred(base, sigma))).sharpness);
    }
    expect(scores[0]!).toBeGreaterThan(scores[1]!);
    expect(scores[1]!).toBeGreaterThan(scores[2]!);
  });
});

describe('can anything be seen', () => {
  it('does not call an ordinary picture dark', async () => {
    const { luma, dark } = await analyseImage(await checkerboard());
    expect(luma).toBeGreaterThan(DARK_MIN_LUMA);
    expect(dark).toBe(false);
  });

  it('calls a nearly black picture dark', async () => {
    const { luma, dark } = await analyseImage(await darkened(await checkerboard()));
    expect(luma).toBeLessThan(DARK_MIN_LUMA);
    expect(dark).toBe(true);
  });

  it('judges focus and darkness separately', async () => {
    // A sharp photograph taken at night is dark, not out of focus, and the
    // two warnings say different things to the person who took it.
    const { dark, blurry } = await analyseImage(await darkened(await checkerboard()));
    expect(dark).toBe(true);
    expect(blurry).toBe(false);
  });
});
