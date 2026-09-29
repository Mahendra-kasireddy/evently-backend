/**
 * Shared Memories: the rules, the bounds and the thresholds.
 *
 * Every number the gallery decides anything by lives here, so a judgement call
 * is a value to argue with rather than a literal buried in a branch.
 *
 * Nothing in this feature is a model. Sorting is the tag the guest chose,
 * falling back to arithmetic on the upload time; the kinds are a duration and
 * a tag; duplicates are a hash; "blurry" and "dark" are two long-standing
 * measurements over the pixels. Named plainly for the next reader, who would
 * otherwise go looking for a model that does not exist.
 */

/** What a piece of uploaded media is, once sorted. */
export enum MediaKind {
  PHOTO = 'photo',
  VIDEO = 'video',
  REEL = 'reel',
}

/** Where a piece of media stands with the organizer. */
export enum MediaState {
  /** Waiting for the organizer, because moderation is on. */
  PENDING = 'pending',
  /** In the gallery. */
  PUBLISHED = 'published',
  /** Held back: a duplicate, or the organizer rejected it. */
  HIDDEN = 'hidden',
}

/** Why a piece of media is not in the gallery, when it is not. */
export enum MediaFlag {
  DUPLICATE = 'duplicate',
  BLURRY = 'blurry',
  DARK = 'dark',
  REJECTED = 'rejected',
}

/**
 * A clip tagged as a reel may be at most this long.
 *
 * The spec described videos as "over 15 seconds" and reels as "under 60
 * seconds tagged as reels", which leaves a 30-second clip tagged as a reel
 * being both and a 10-second clip tagged as neither being nothing. The tag
 * decides instead: a clip the guest marked as a reel is a reel if it fits,
 * and every other clip is a video whatever its length.
 */
export const REEL_MAX_SECONDS = 60;

/** Longest clip of any kind. Beyond this the upload is refused outright. */
export const CLIP_MAX_SECONDS = 15 * 60;

/**
 * How alike two photographs may be before the second is a duplicate.
 *
 * A Hamming distance over a 64-bit difference hash. 0 is the same image;
 * under about 10 is the same moment — a burst of three, or the same frame
 * saved twice by two apps at different quality. Above that, two people
 * photographing the same couple from two sides start being caught, which is
 * not a duplicate: it is the point of a shared gallery.
 */
export const DUPLICATE_HAMMING_MAX = 8;

/**
 * Below this variance of the Laplacian, a photograph reads as out of focus.
 *
 * The measure is the spread of the second derivative across the image: an
 * in-focus edge is a sharp step and a blurred one is a ramp, so blur flattens
 * the distribution. The threshold is the conventional starting point and is
 * deliberately forgiving — a wrongly hidden photograph of somebody's wedding
 * is a worse failure than a soft one that got through, which is also why the
 * uploader can overrule it.
 */
export const BLUR_MIN_VARIANCE = 55;

/** Below this mean luminance (0–255), a photograph reads as too dark. */
export const DARK_MIN_LUMA = 38;

/** Longest side the analysis works at. Bigger costs time and changes nothing. */
export const ANALYSIS_SIZE = 256;

/* ---- renditions -------------------------------------------------------- */

/**
 * The grid's thumbnail: longest side, in pixels.
 *
 * The gallery is two columns on a phone, so a cell is about 175 CSS pixels
 * wide; at the 3× density those phones have, 600 covers it with room for a
 * tablet's three columns and still nothing like the 12-megapixel original.
 * Fitted inside rather than cropped to a square — a square crop of a wedding
 * photograph is a reliable way to cut somebody's head off.
 */
export const THUMBNAIL_MAX_PX = 600;

/**
 * The full-screen rendition: longest side, in pixels.
 *
 * What the viewer opens. 1600 is sharp on any phone and most laptops at a
 * fraction of an original's bytes; the original itself is reserved for the
 * download, where the guest has asked for the real file.
 */
export const DISPLAY_MAX_PX = 1600;

/** WebP, because it is half of JPEG at the same quality and universally read. */
export const THUMBNAIL_QUALITY = 72;
export const DISPLAY_QUALITY = 80;

/** Most items one guest may add to one invitation. */
export const MEMORIES_MAX_PER_GUEST = 60;

/** Caption bound, matching the story's. */
export const MEMORY_CAPTION_MAX = 120;

/** Days after the event that uploads stay open, until the organizer says. */
export const DEFAULT_UPLOAD_WINDOW_DAYS = 7;
