/**
 * Who fills a section in.
 *
 * Defined here rather than on the schema because the schema reads this
 * module's catalogues — block types, fonts, the welcome-message cap — and two
 * modules that import each other leave whichever loads second holding
 * `undefined` at the moment its enums are evaluated. The catalogue is the
 * bottom of the stack: it imports nothing of the invitation's own.
 */
export enum BlockOwner {
  ORGANIZER = 'organizer',
  CUSTOMER = 'customer',
}

/**
 * The section catalogue every new invitation starts from — a product decision
 * (like `tier-config`), not derived data, so it lives on the server and the
 * client renders whatever the API returns rather than carrying its own copy.
 *
 * `owner` decides who fills a section in: the organizer handles logistics
 * (countdown, live stream, gate pass, transport), the customer personalises
 * the human parts (names, story, photos) from their own screen.
 */
/**
 * What kind of block this is.
 *
 * The key names one block on one invitation; the type says which editor and
 * which guest renderer it needs. Only `cover` is implemented — the rest are
 * declared so an invitation stored today still says what its sections are
 * when their renderers arrive, and so adding one is a new case rather than a
 * migration.
 */
export enum BlockType {
  COVER = 'cover',
  STORY = 'story',
  COUNTDOWN = 'countdown',
  MEMORIES = 'memories',
  GUEST_WALL = 'guestWall',
  LIVE_STREAM = 'liveStream',
  SAVE_THE_DATE = 'saveTheDate',
  RIDE = 'ride',
  /** Anything stored before types existed, and anything not yet catalogued. */
  GENERIC = 'generic',
}

/** The cover is the first block of every invitation and cannot be removed. */
export const COVER_BLOCK_KEY = 'header';

/** Which type an existing block key means, for invitations stored before types. */
export const BLOCK_TYPE_BY_KEY: Record<string, BlockType> = {
  header: BlockType.COVER,
  story: BlockType.STORY,
  countdown: BlockType.COUNTDOWN,
  memories: BlockType.MEMORIES,
  wishes: BlockType.GUEST_WALL,
  guestWall: BlockType.GUEST_WALL,
  live: BlockType.LIVE_STREAM,
  liveStream: BlockType.LIVE_STREAM,
  saveTheDate: BlockType.SAVE_THE_DATE,
  ride: BlockType.RIDE,
};

export interface DefaultBlock {
  key: string;
  title: string;
  icon: string;
  owner: BlockOwner;
  heading: string;
  body: string;
}

export const DEFAULT_BLOCKS: DefaultBlock[] = [
  {
    key: 'header',
    /* What the customer calls it. "Invitation header" is the builder's word
       for the cover, and nobody reading their own invitation uses it. */
    title: 'Cover',
    icon: 'image',
    owner: BlockOwner.CUSTOMER,
    heading: '',
    body: '',
  },
  {
    key: 'story',
    title: 'Our story',
    icon: 'sparkles',
    owner: BlockOwner.CUSTOMER,
    heading: 'How it began',
    body: '',
  },
  {
    key: 'countdown',
    title: 'Countdown',
    icon: 'clock',
    owner: BlockOwner.ORGANIZER,
    heading: '',
    body: '',
  },
  {
    key: 'save-the-date',
    title: 'Save the date',
    icon: 'calendar',
    owner: BlockOwner.ORGANIZER,
    heading: '',
    body: '',
  },
  {
    key: 'live-stream',
    title: 'Live stream',
    icon: 'play',
    owner: BlockOwner.ORGANIZER,
    heading: 'Watch the ceremony live',
    body: '',
  },
  {
    key: 'memories',
    title: 'Shared memories',
    icon: 'camera',
    owner: BlockOwner.CUSTOMER,
    heading: '',
    body: '',
  },
  {
    key: 'guest-wall',
    title: 'Guest wall',
    icon: 'users',
    owner: BlockOwner.CUSTOMER,
    heading: 'Wishes & messages',
    body: '',
  },
  {
    key: 'ride',
    title: 'Book a ride',
    icon: 'car',
    owner: BlockOwner.ORGANIZER,
    heading: '',
    body: '',
  },
  {
    key: 'gate-pass',
    title: 'Gate pass',
    icon: 'qr',
    owner: BlockOwner.ORGANIZER,
    heading: '',
    body: '',
  },
  {
    key: 'trees',
    title: 'Plant 10 trees',
    icon: 'tree',
    owner: BlockOwner.ORGANIZER,
    heading: '',
    body: '',
  },
];

/** Templates the organizer can dress the guest invitation in. */
export interface InvitationTemplateConfig {
  id: string;
  label: string;
  hero: string;
  /**
   * The same ramp as `hero`, as plain colours.
   *
   * A native client paints a gradient from stops, not from a CSS string, and
   * parsing `linear-gradient(...)` on the device to recover them is a parser
   * nobody should have to own. Both are generated from one palette here, so
   * they cannot disagree.
   */
  heroStops: string[];
  wash: string;
  accent: string;
}

/**
 * The typography styles an organizer chooses from, by the name they would use
 * for them rather than by a family name.
 *
 * Server-owned for the same reason the templates are: the set is a product
 * decision, and a face the client invents is refused on the way in. The id is
 * the contract; how each one is drawn belongs to the client, which is the only
 * side that knows which faces it actually ships — naming a file here that the
 * app does not bundle would silently fall back to the system font.
 */
export interface InvitationFontConfig {
  id: string;
  label: string;
  /** One line describing the look, so a picker can be read before it is tapped. */
  note: string;
}

export const INVITATION_FONTS: InvitationFontConfig[] = [
  { id: 'elegant', label: 'Elegant', note: 'Serif, letter-spaced' },
  { id: 'classic', label: 'Classic', note: 'The app\u2019s own face' },
  { id: 'romantic', label: 'Romantic', note: 'Serif italic' },
  { id: 'modern', label: 'Modern', note: 'Bold and tight' },
  { id: 'traditional', label: 'Traditional', note: 'Serif, set in capitals' },
];

export const DEFAULT_FONT_ID = 'elegant';

/** What the organizer may put behind the cover, and nothing else. */
export enum HeroMediaType {
  NONE = '',
  IMAGE = 'image',
  VIDEO = 'video',
}

/**
 * How long an uploaded invitation video may run.
 *
 * Five minutes. The organizer uploads the invitation itself — a designed
 * save-the-date reel with names, dates and venue in it — and a reel with a
 * full song or the couple's story runs past two minutes often enough that
 * the old cap refused real invitations at the door. Keep in step with
 * VIDEO_MAX_SECONDS in the web editor and the `video` upload size rule.
 */
export const HERO_VIDEO_MAX_SECONDS = 300;

/**
 * The welcome message's cap, in characters.
 *
 * One number, used by the schema, by the DTO that rejects a longer one and by
 * the counter the editor shows — a second copy anywhere is a counter that
 * disagrees with the save.
 */
export const WELCOME_MESSAGE_MAX = 200;

/**
 * The story the organizer tells in photographs: a short sequence, not an album.
 *
 * Twelve cards is the point past which a guest stops swiping and starts
 * scrolling away, and one caption line is what fits under a photograph without
 * turning the card into a page of text. Both are enforced on the way in — the
 * editor's counter is a courtesy, not a control.
 */
/**
 * The notifications an invitation can raise with a guest.
 *
 * An enum with one member today, because the dismissal record is keyed by it:
 * a second notification added later must not be silenced by a guest having
 * dismissed the first.
 */
export enum NotificationKind {
  /** The day before the event the countdown points at. */
  ONE_DAY = 'oneDay',
  /** The moment an event's live stream was switched on. */
  LIVE_STARTED = 'liveStarted',
}

/** How close the event has to be before the one-day notice is due. */
export const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * What the one-day notice says until the organizer writes their own, and what
 * it says instead to a guest who only opens the invitation after the event.
 *
 * Two messages, not one: a guest reading "we can't wait to celebrate with you"
 * the morning after the wedding is being told something that is no longer
 * true, and the spec is explicit that the stale wording must not be shown.
 */
export const DEFAULT_ONE_DAY_MESSAGE =
  'We\u2019re almost there \u2014 we can\u2019t wait to celebrate with you.';
export const DEFAULT_MISSED_MESSAGE = 'We hope you had a wonderful time.';

/** The same cap the post-event message already uses. */
export const NOTIFICATION_MESSAGE_MAX = 400;

/* ---- F5: the live stream ------------------------------------------------ */

/** What the "it's started" card says until the organizer writes their own. */
export const DEFAULT_LIVE_MESSAGE = 'Join us and watch the celebration live from anywhere.';

/** What the live section is called until the organizer names it. */
export const DEFAULT_LIVE_TITLE = 'Watch the ceremony live';

export const LIVE_TITLE_MAX = 80;
export const LIVE_URL_MAX = 500;

/**
 * How recently a guest must have been counted to still be "watching".
 *
 * The client says it is still there roughly every 45 seconds, so this is two
 * heartbeats: one missed ping is a slow network, two is a closed tab.
 */
export const LIVE_WATCHING_WINDOW_MS = 90 * 1000;

/**
 * The hosts a stream may be embedded from.
 *
 * An allowlist and not a URL format check. The value ends up as the `src` of
 * an iframe on a page a guest opens from a link, so anything the organizer can
 * type there runs in the guest's browser on the invitation's own origin's
 * behalf — `javascript:`, `data:`, or an attacker's page dressed as a stream.
 * Players we can name are the only thing that gets in.
 */
export const LIVE_EMBED_HOSTS: readonly string[] = [
  'www.youtube.com',
  'youtube.com',
  'www.youtube-nocookie.com',
  'youtube-nocookie.com',
  'youtu.be',
  'player.vimeo.com',
  'vimeo.com',
  'www.facebook.com',
  'fb.watch',
  'player.twitch.tv',
  'www.dailymotion.com',
  'iframe.mediadelivery.net',
  'customer-embed.cloudflarestream.com',
  'iframe.videodelivery.net',
];

/** `https`, and a host on the list above. Anything else is not embeddable. */
export function isEmbeddableStreamUrl(value: string): boolean {
  if (!value) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  return LIVE_EMBED_HOSTS.includes(url.hostname.toLowerCase());
}

export const STORY_MAX_CARDS = 12;
export const STORY_CAPTION_MAX = 120;
export const STORY_TITLE_MAX = 60;
/** What the section is called until the organizer names it themselves. */
export const DEFAULT_STORY_TITLE = 'Our story';

export const INVITATION_TEMPLATES: InvitationTemplateConfig[] = [
  {
    id: 'midnight',
    label: 'Midnight',
    hero: 'linear-gradient(165deg,#101B33,#1A2E5A 58%,#2B1E32)',
    heroStops: ['#101B33', '#1A2E5A', '#2B1E32'],
    wash: '#FBF7F1',
    accent: '#FFB48A',
  },
  /*
   * The four palettes the product asks for, beside the two that were already
   * here. Ivory was one of them and is reused rather than redefined; midnight
   * stays because invitations are stored against it.
   */
  {
    id: 'marigold',
    label: 'Marigold',
    hero: 'linear-gradient(165deg,#5A2E0B,#B4641A 58%,#3A1D06)',
    heroStops: ['#5A2E0B', '#B4641A', '#3A1D06'],
    wash: '#FFF7EA',
    accent: '#F2A33C',
  },
  {
    id: 'emerald',
    label: 'Emerald',
    hero: 'linear-gradient(165deg,#07281F,#145C46 60%,#04160F)',
    heroStops: ['#07281F', '#145C46', '#04160F'],
    wash: '#F1F8F4',
    accent: '#4FC79B',
  },
  {
    id: 'roseGold',
    label: 'Rose Gold',
    hero: 'linear-gradient(165deg,#4A2229,#A35D5A 58%,#2C1317)',
    heroStops: ['#4A2229', '#A35D5A', '#2C1317'],
    wash: '#FFF3F0',
    accent: '#E8A08C',
  },
  {
    id: 'royalBlue',
    label: 'Royal Blue',
    hero: 'linear-gradient(165deg,#0B1B45,#23407F 58%,#050C21)',
    heroStops: ['#0B1B45', '#23407F', '#050C21'],
    wash: '#F1F4FD',
    accent: '#7EA2F5',
  },
  {
    id: 'ivory',
    label: 'Ivory',
    hero: 'linear-gradient(165deg,#3A2E24,#6B4E32 62%,#2A211A)',
    heroStops: ['#3A2E24', '#6B4E32', '#2A211A'],
    wash: '#FBF4ED',
    accent: '#E9C88B',
  },
  {
    id: 'garden',
    label: 'Garden',
    hero: 'linear-gradient(165deg,#0E2B22,#13633F 60%,#0B1F1A)',
    heroStops: ['#0E2B22', '#13633F', '#0B1F1A'],
    wash: '#F1F7F2',
    accent: '#CFF5E2',
  },
];

/**
 * Colours a Save-the-Date card can be given.
 *
 * A closed, server-owned set for the same reason `INVITATION_TEMPLATES` is one:
 * it is a product decision, and the client renders what the API serves rather
 * than carrying its own copy that drifts. Each entry carries the two values a
 * card actually needs — a wash for the card body and an ink that is legible on
 * it — so contrast is decided once here rather than per organizer.
 */
export interface CardColourConfig {
  id: string;
  label: string;
  /** Card background. */
  wash: string;
  /** Text and rule colour on that wash. */
  ink: string;
}

export const CARD_PALETTE: CardColourConfig[] = [
  { id: 'sand', label: 'Sand', wash: '#F6EBDD', ink: '#5A4326' },
  { id: 'rose', label: 'Rose', wash: '#F8E4E6', ink: '#6E2B36' },
  { id: 'sage', label: 'Sage', wash: '#E4EFE4', ink: '#2C4A31' },
  { id: 'sky', label: 'Sky', wash: '#E3EDF8', ink: '#25415F' },
  { id: 'lilac', label: 'Lilac', wash: '#EDE6F6', ink: '#43305E' },
  { id: 'ink', label: 'Ink', wash: '#E7E9EF', ink: '#1F2537' },
];

export const CARD_COLOUR_IDS: string[] = CARD_PALETTE.map((c) => c.id);

/** Minutes a Save-the-Date calendar entry runs for when no end time is given. */
export const DEFAULT_SUB_EVENT_MINUTES = 180;

export const DEFAULT_TEMPLATE_ID = 'midnight';
export const DEFAULT_EYEBROW = 'TOGETHER WITH THEIR FAMILIES';
export const DEFAULT_JOINER = 'and';

/** How many days before the event the RSVP cut-off is seeded at. */
export const RSVP_LEAD_DAYS = 14;
