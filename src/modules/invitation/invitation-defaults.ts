import { BlockOwner } from './schemas/invitation.schema';

/**
 * The section catalogue every new invitation starts from — a product decision
 * (like `tier-config`), not derived data, so it lives on the server and the
 * client renders whatever the API returns rather than carrying its own copy.
 *
 * `owner` decides who fills a section in: the organizer handles logistics
 * (countdown, live stream, gate pass, transport), the customer personalises
 * the human parts (names, story, photos) from their own screen.
 */
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
    title: 'Invitation header',
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
  wash: string;
  accent: string;
}

export const INVITATION_TEMPLATES: InvitationTemplateConfig[] = [
  {
    id: 'midnight',
    label: 'Midnight',
    hero: 'linear-gradient(165deg,#101B33,#1A2E5A 58%,#2B1E32)',
    wash: '#FBF7F1',
    accent: '#FFB48A',
  },
  {
    id: 'ivory',
    label: 'Ivory',
    hero: 'linear-gradient(165deg,#3A2E24,#6B4E32 62%,#2A211A)',
    wash: '#FBF4ED',
    accent: '#E9C88B',
  },
  {
    id: 'garden',
    label: 'Garden',
    hero: 'linear-gradient(165deg,#0E2B22,#13633F 60%,#0B1F1A)',
    wash: '#F1F7F2',
    accent: '#CFF5E2',
  },
];

export const DEFAULT_TEMPLATE_ID = 'midnight';
export const DEFAULT_EYEBROW = 'TOGETHER WITH THEIR FAMILIES';
export const DEFAULT_JOINER = 'and';

/** How many days before the event the RSVP cut-off is seeded at. */
export const RSVP_LEAD_DAYS = 14;
