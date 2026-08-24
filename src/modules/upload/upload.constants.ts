/**
 * Upload purposes and their server-side validation rules. One place governs
 * what every module (customer, organizer, admin, events, quotes, bookings,
 * reviews, chat) is allowed to upload — the Upload module is intentionally
 * generic and NOT coupled to any single feature.
 */
export enum UploadPurpose {
  PROFILE_IMAGE = 'profileImage',
  COVER_IMAGE = 'coverImage',
  GALLERY = 'gallery',
  VIDEO = 'video',
  GOVERNMENT_ID = 'governmentId',
  CERTIFICATE = 'certificate',
  BUSINESS_LICENSE = 'businessLicense',
  PAN = 'pan',
  GST = 'gst',
  CANCELLED_CHEQUE = 'cancelledCheque',
  CHAT_ATTACHMENT = 'chatAttachment',
  TASK_PROOF = 'taskProof',
  /** Reference photos attached to an idea on a booking's planning board. */
  IDEA_IMAGE = 'ideaImage',
}

export interface ImageDimensionRule {
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
}

export interface UploadRule {
  /** Max file size in bytes. */
  maxBytes: number;
  /** Allowed MIME types (exact match against the sniffed/declared type). */
  mimeTypes: string[];
  /** Allowed lowercase extensions (belt-and-braces with the MIME check). */
  extensions: string[];
  /** When set, the file is treated as an image and its pixel size is validated. */
  image?: ImageDimensionRule;
}

const MB = 1024 * 1024;

const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp'];
const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'webp'];
const DOC_MIMES = ['application/pdf', 'image/jpeg', 'image/png'];
const DOC_EXTS = ['pdf', 'jpg', 'jpeg', 'png'];
const VIDEO_MIMES = ['video/mp4', 'video/webm', 'video/quicktime'];
const VIDEO_EXTS = ['mp4', 'webm', 'mov'];

/** Purpose → validation rule. Every purpose must be represented. */
export const UPLOAD_RULES: Record<UploadPurpose, UploadRule> = {
  [UploadPurpose.PROFILE_IMAGE]: {
    maxBytes: 5 * MB,
    mimeTypes: IMAGE_MIMES,
    extensions: IMAGE_EXTS,
    image: { minWidth: 100, minHeight: 100, maxWidth: 4096, maxHeight: 4096 },
  },
  [UploadPurpose.COVER_IMAGE]: {
    maxBytes: 8 * MB,
    mimeTypes: IMAGE_MIMES,
    extensions: IMAGE_EXTS,
    image: { minWidth: 600, minHeight: 200, maxWidth: 6000, maxHeight: 4000 },
  },
  [UploadPurpose.GALLERY]: {
    maxBytes: 8 * MB,
    mimeTypes: IMAGE_MIMES,
    extensions: IMAGE_EXTS,
    image: { minWidth: 200, minHeight: 200, maxWidth: 6000, maxHeight: 6000 },
  },
  [UploadPurpose.VIDEO]: {
    maxBytes: 100 * MB,
    mimeTypes: VIDEO_MIMES,
    extensions: VIDEO_EXTS,
  },
  [UploadPurpose.GOVERNMENT_ID]: { maxBytes: 10 * MB, mimeTypes: DOC_MIMES, extensions: DOC_EXTS },
  [UploadPurpose.CERTIFICATE]: { maxBytes: 10 * MB, mimeTypes: DOC_MIMES, extensions: DOC_EXTS },
  [UploadPurpose.BUSINESS_LICENSE]: {
    maxBytes: 10 * MB,
    mimeTypes: DOC_MIMES,
    extensions: DOC_EXTS,
  },
  [UploadPurpose.PAN]: { maxBytes: 10 * MB, mimeTypes: DOC_MIMES, extensions: DOC_EXTS },
  [UploadPurpose.GST]: { maxBytes: 10 * MB, mimeTypes: DOC_MIMES, extensions: DOC_EXTS },
  [UploadPurpose.CANCELLED_CHEQUE]: {
    maxBytes: 10 * MB,
    mimeTypes: DOC_MIMES,
    extensions: DOC_EXTS,
  },
  [UploadPurpose.CHAT_ATTACHMENT]: {
    maxBytes: 25 * MB,
    mimeTypes: [...IMAGE_MIMES, ...DOC_MIMES, ...VIDEO_MIMES],
    extensions: [...IMAGE_EXTS, ...DOC_EXTS, ...VIDEO_EXTS],
  },
  [UploadPurpose.TASK_PROOF]: {
    maxBytes: 8 * MB,
    mimeTypes: IMAGE_MIMES,
    extensions: IMAGE_EXTS,
  },
  [UploadPurpose.IDEA_IMAGE]: {
    maxBytes: 8 * MB,
    mimeTypes: IMAGE_MIMES,
    extensions: IMAGE_EXTS,
    image: { minWidth: 80, minHeight: 80, maxWidth: 6000, maxHeight: 6000 },
  },
};
