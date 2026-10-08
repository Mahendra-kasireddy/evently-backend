import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { idJsonTransform } from '../../../common/utils/id-transform';
import {
  BlockOwner,
  BlockType,
  DEFAULT_FONT_ID,
  HERO_VIDEO_MAX_SECONDS,
  DEFAULT_MISSED_MESSAGE,
  DEFAULT_ONE_DAY_MESSAGE,
  HeroMediaType,
  NOTIFICATION_MESSAGE_MAX,
  STORY_CAPTION_MAX,
  STORY_TITLE_MAX,
  WELCOME_MESSAGE_MAX,
} from '../invitation-defaults';
import { GuestGroup } from './invitation-guest.schema';

export type InvitationDocument = HydratedDocument<Invitation>;

/** Where the invitation sits in the organizer → customer approval loop. */
export enum InvitationStatus {
  /** Organizer is still assembling it; the customer cannot see it. */
  DRAFT = 'draft',
  /** Handed to the customer for review. */
  SENT = 'sent',
  /** Customer signed it off — the guest link is live. */
  APPROVED = 'approved',
}

/** Who fills a section in: the organizer, or the customer on their own screen. */
/* Lives in the catalogue, which this module reads; re-exported so every
   existing importer keeps its one import of it. */
export { BlockOwner };

/** One section of the guest invitation — and one row of the builder. */
@Schema({ _id: false })
export class InvitationBlock {
  @Prop({ required: true, trim: true })
  key: string;

  /**
   * Which editor and which guest renderer this block needs.
   *
   * The key names one block on one invitation; the type says what it is. It
   * is what lets Story, Countdown and the rest be added as their own
   * renderers later without the cover's code knowing about them.
   */
  @Prop({ type: String, enum: BlockType, default: BlockType.GENERIC })
  type: BlockType;

  @Prop({ required: true, trim: true })
  title: string;

  /** Icon name resolved to a real glyph by the client. */
  @Prop({ required: true, trim: true })
  icon: string;

  @Prop({ type: String, enum: BlockOwner, required: true })
  owner: BlockOwner;

  @Prop({ default: false })
  hidden: boolean;

  /** Headline shown to guests; blank falls back to `title`. */
  @Prop({ trim: true, default: '' })
  heading: string;

  @Prop({ trim: true, default: '' })
  body: string;

  /**
   * The customer has signed this section off.
   *
   * Per block, because that is how the customer reads it: they go down the
   * invitation accepting one section at a time, and an invitation that can
   * only be approved whole forces them to accept the parts they have not read
   * to get to the one they have. The guest link goes live when the last
   * visible block is approved — the whole-invitation approve does all of them
   * at once, which is the same decision said in one tap.
   *
   * False on every block of an invitation approved before this field existed;
   * the view reports them as approved because their invitation is.
   */
  @Prop({ default: false })
  approved: boolean;
}
export const InvitationBlockSchema = SchemaFactory.createForClass(InvitationBlock);

/**
 * Who a Save-the-Date card is shown to.
 *
 * Only two values, deliberately. Targeting a card at named invitees needs an
 * invitee to point at, and the platform has no guest record of any kind yet —
 * no guest list, no share link, no guest identity. Adding a `SPECIFIC` value
 * now would be a state nothing can ever set or honour, so it waits for the
 * guest surface that gives it meaning.
 */
export enum SubEventVisibility {
  /** Every guest who opens the invitation sees this card. */
  ALL_GUESTS = 'all',
  /**
   * Only guests filed under one of the card's groups.
   *
   * The groups are the ones the guest list already keeps — family, friends,
   * work — so targeting a card reuses the filing the organizer has been doing
   * all along rather than asking them to build a second list.
   */
  GROUPS = 'groups',
  /** Kept in the builder but not rendered to guests. */
  HIDDEN = 'hidden',
}

/**
 * One sub-event of the celebration — a mehendi, the ceremony, a reception —
 * and one Save-the-Date card.
 *
 * Sub-events live on the invitation rather than in their own collection: they
 * exist only as part of the invitation an organizer assembles for one booking,
 * are always read and written with it, and are bounded in number. That is the
 * same reasoning as `blocks`, and it keeps the guest view a single document
 * read.
 *
 * Note this is unrelated to the `plan-event` `Event` collection, which models a
 * ticketed listing with capacity and a price. Reusing that here would have
 * dragged in a payment and publishing lifecycle the invitation has no use for.
 */
@Schema({ _id: true })
export class InvitationSubEvent {
  @Prop({ required: true, trim: true, maxlength: 80 })
  name: string;

  /** `yyyy-mm-dd` — a wall-clock date, read against `timezone` below. */
  @Prop({ trim: true, default: '' })
  eventDate: string;

  /** `HH:mm`. */
  @Prop({ trim: true, default: '' })
  eventTime: string;

  /**
   * `HH:mm`, optional.
   *
   * Not asked for on the card, but a calendar entry has to end somewhere: an
   * organizer who leaves this blank gets the default duration rather than an
   * entry that runs to midnight or is rejected outright by the calendar app.
   */
  @Prop({ trim: true, default: '' })
  endTime: string;

  /** IANA zone the two wall-clock fields above are expressed in. */
  @Prop({ trim: true, default: 'Asia/Kolkata' })
  timezone: string;

  @Prop({ trim: true, default: '', maxlength: 120 })
  venueName: string;

  @Prop({ trim: true, default: '', maxlength: 240 })
  venueAddress: string;

  @Prop({ trim: true, default: '', maxlength: 80 })
  dressCode: string;

  @Prop({ trim: true, default: '', maxlength: 300 })
  note: string;

  /**
   * Card colour, as a palette id from `CARD_PALETTE` — an id and not a raw hex
   * value, so a card can never be styled into illegibility and the palette can
   * be restyled centrally. Empty means "follow the invitation template".
   */
  @Prop({ trim: true, default: '' })
  colour: string;

  @Prop({ type: String, enum: SubEventVisibility, default: SubEventVisibility.ALL_GUESTS })
  visibility: SubEventVisibility;

  /**
   * Which guest groups this card is for, when `visibility` is `groups`.
   *
   * Ignored for the other two, so a card switched back to "everyone" does not
   * quietly keep a targeting rule nobody can see.
   */
  @Prop({ type: [String], enum: GuestGroup, default: [] })
  groups: GuestGroup[];

  /* ---- F5: this event's live stream --------------------------------------
   *
   * On the sub-event and not on the invitation, because "live" is a property
   * of one ceremony: a wedding streams the muhurtham and not the mehendi, and
   * the guests who may watch are exactly the guests invited to that event —
   * a rule `visibility` and `groups` above already carry, so the stream
   * inherits it rather than restating it in a second, disagreeable place.
   */

  /** The organizer's switch. Off means no guest is shown anything at all. */
  @Prop({ type: Boolean, default: false })
  liveEnabled: boolean;

  @Prop({ trim: true, default: '', maxlength: 80 })
  liveTitle: string;

  /** Embed url, validated against the host allowlist on the way in. */
  @Prop({ trim: true, default: '', maxlength: 500 })
  liveUrl: string;

  /** Optional alternates. A mode with no url is not offered to guests. */
  @Prop({ trim: true, default: '', maxlength: 500 })
  live360Url: string;

  @Prop({ trim: true, default: '', maxlength: 500 })
  liveVrUrl: string;

  /**
   * When the switch was last turned on.
   *
   * Recorded server-side so "it has started" is an observation and not a
   * client's opinion: the pop-up, and the banner on an invitation that was
   * already open, both key off this.
   */
  @Prop({ type: Date })
  liveStartedAt?: Date;
}
export const InvitationSubEventSchema = SchemaFactory.createForClass(InvitationSubEvent);

/**
 * Shared Memories, as the customer configures it.
 *
 * A subdocument of its own rather than more fields on `InvitationDetails`,
 * and that is the security design and not tidiness: `details` is written by
 * the organizer's PATCH and read into the organizer's view, so a setting
 * living there is one spread away from being theirs. These are the customer's
 * — it is their guests, their photographs and their decision whether
 * strangers can download them — so they sit where no organizer route
 * touches them.
 */
@Schema({ _id: false })
export class InvitationMemories {
  /** The whole feature. Off means the section does not exist for anyone. */
  @Prop({ type: Boolean, default: false })
  enabled: boolean;

  @Prop({ type: Boolean, default: true })
  guestUpload: boolean;

  @Prop({ type: Boolean, default: true })
  guestView: boolean;

  /** Off by default: someone else's wedding photographs are not a download. */
  @Prop({ type: Boolean, default: false })
  guestDownload: boolean;

  /** On, every upload waits for the customer before any guest sees it. */
  @Prop({ type: Boolean, default: false })
  moderation: boolean;

  /**
   * `yyyy-mm-dd`, or '' to open from the moment the feature is switched on.
   * Read against the invitation's own timezone, like every other date here.
   */
  @Prop({ trim: true, default: '' })
  uploadFrom: string;

  /** Days after the last celebration that uploads stay open. */
  @Prop({ type: Number, default: 7, min: 0, max: 365 })
  uploadWindowDays: number;
}
export const InvitationMemoriesSchema = SchemaFactory.createForClass(InvitationMemories);

/** Event-level details every section of the invitation draws from. */
@Schema({ _id: false })
export class InvitationDetails {
  @Prop({ trim: true, default: 'midnight' })
  template: string;

  @Prop({ trim: true, default: '' })
  eyebrow: string;

  @Prop({ trim: true, default: '' })
  hostOne: string;

  @Prop({ trim: true, default: '' })
  hostTwo: string;

  @Prop({ trim: true, default: 'and' })
  joiner: string;

  /** `yyyy-mm-dd` — a wall-clock date, deliberately not a timezone-bearing Date. */
  @Prop({ trim: true, default: '' })
  eventDate: string;

  /** `HH:mm`. */
  @Prop({ trim: true, default: '' })
  eventTime: string;

  @Prop({ trim: true, default: '' })
  venueName: string;

  @Prop({ trim: true, default: '' })
  venueAddress: string;

  /** The welcome message on the cover. One cap, shared with the DTO. */
  @Prop({ trim: true, default: '', maxlength: WELCOME_MESSAGE_MAX })
  message: string;

  /*
   * The cover's hero media.
   *
   * Stored as the upload module returns it — a url and the storage key — so
   * the media itself lives where every other upload does and nothing here
   * duplicates that infrastructure. Empty type means the organizer has not
   * uploaded anything, and the guest view falls back to the palette's own
   * pattern rather than to a stock photograph of somebody else's wedding.
   */
  @Prop({ type: String, enum: HeroMediaType, default: HeroMediaType.NONE })
  heroMediaType: HeroMediaType;

  @Prop({ trim: true, default: '' })
  heroMediaUrl: string;

  @Prop({ trim: true, default: '' })
  heroMediaKey: string;

  /** What the story section is called, e.g. "Our Journey". */
  @Prop({ trim: true, default: '', maxlength: STORY_TITLE_MAX })
  storyTitle: string;

  /**
   * Which sub-event the countdown points at, by its id.
   *
   * A reference, not a copy: the sub-event owns its date, time, zone and
   * venue, and a snapshot here would be the version that goes stale the moment
   * the organizer moves the ceremony. Empty means the invitation's own date —
   * which is also what an invitation with no sub-events counts down to.
   */
  @Prop({ trim: true, default: '' })
  countdownSubEventId: string;

  /** Whether the day-before notice is raised with guests at all. */
  @Prop({ default: true })
  oneDayNotificationEnabled: boolean;

  /** The body of that notice, and of the one a guest gets if they miss it. */
  @Prop({ trim: true, default: DEFAULT_ONE_DAY_MESSAGE, maxlength: NOTIFICATION_MESSAGE_MAX })
  oneDayNotificationMessage: string;

  @Prop({ trim: true, default: DEFAULT_MISSED_MESSAGE, maxlength: NOTIFICATION_MESSAGE_MAX })
  missedNotificationMessage: string;

  /**
   * A video's length, as the uploading client measured it.
   *
   * Bounded at 30 on the way in. The server cannot re-measure it without a
   * media pipeline, so this is the client's claim rather than a verified
   * fact — it decides what the editor allows, not what the guest is served.
   */
  @Prop({ default: 0, min: 0, max: HERO_VIDEO_MAX_SECONDS })
  heroMediaDurationSec: number;

  /** One of INVITATION_FONTS — a style the app ships, never a family name. */
  @Prop({ trim: true, default: DEFAULT_FONT_ID })
  fontStyle: string;

  /**
   * IANA zone the wall-clock eventDate/eventTime above are expressed in.
   *
   * Those two fields carry no zone of their own, which is fine for printing a
   * date but not for a live countdown: a guest opening the invitation from
   * another country must still see the correct time remaining. Resolving the
   * pair against this zone is what makes that true.
   *
   * Defaults to Asia/Kolkata because every city in the platform's own
   * configuration is Indian; an organizer running an event elsewhere changes
   * it in the builder.
   */
  @Prop({ trim: true, default: 'Asia/Kolkata' })
  timezone: string;

  /**
   * Shown in place of the countdown once the event's start time has passed.
   * Empty means the countdown simply stops at zero rather than inventing a
   * message the organizer never wrote.
   */
  @Prop({ trim: true, default: '', maxlength: 400 })
  postEventMessage: string;

  @Prop({ default: true })
  rsvpEnabled: boolean;

  /** `yyyy-mm-dd`. */
  @Prop({ trim: true, default: '' })
  rsvpDeadline: string;

  @Prop({ default: true })
  rsvpPlusOnes: boolean;
}
export const InvitationDetailsSchema = SchemaFactory.createForClass(InvitationDetails);

/**
 * One photograph in the couple's story, and the line that goes under it.
 *
 * A subdocument on the invitation rather than a collection of its own: it
 * belongs to exactly one invitation, is only ever read with it, and inherits
 * its ownership — a story card cannot outlive or escape the invitation it was
 * written for, and no second authorization rule has to agree with the first.
 */
@Schema({ _id: true })
export class InvitationStoryCard {
  /** As the upload endpoint returned it. Photographs only — never a video. */
  @Prop({ required: true, trim: true, maxlength: 600 })
  imageUrl: string;

  /** Storage handle, for replacing or deleting. Never sent to a guest. */
  @Prop({ trim: true, default: '', maxlength: 300 })
  imageKey: string;

  @Prop({ trim: true, default: '', maxlength: STORY_CAPTION_MAX })
  caption: string;

  /**
   * Where this card sits in the story, stored rather than inferred.
   *
   * Array position would be the same thing until something reads the array
   * back in a different order — a projection, a migration, a driver that does
   * not promise order — and then the couple's story is told backwards.
   */
  @Prop({ required: true, min: 0 })
  order: number;
}
export const InvitationStoryCardSchema = SchemaFactory.createForClass(InvitationStoryCard);

/**
 * A change the customer asked for on a section they do not own.
 *
 * Stored on the invitation rather than sent only as a notification: the
 * organizer has to be able to see the outstanding asks in the builder, so
 * "Request change" reaches someone who can act on it.
 */
@Schema({ _id: true })
export class InvitationChangeRequest {
  /** Empty when the customer asked about the invitation as a whole. */
  @Prop({ trim: true, default: '' })
  blockKey: string;

  /** Section name as it read when the ask was made. */
  @Prop({ trim: true, default: '' })
  blockTitle: string;

  @Prop({ required: true, trim: true, maxlength: 2000 })
  note: string;

  @Prop({ type: Date, default: () => new Date() })
  at: Date;

  @Prop({ default: false })
  resolved: boolean;
}
export const InvitationChangeRequestSchema = SchemaFactory.createForClass(InvitationChangeRequest);

/**
 * The guest invitation an organizer assembles for one booking (P-15). One per
 * booking — the organizer owns the logistics sections, the customer owns the
 * personal ones and gives the final sign-off that makes the guest link live.
 */
@Schema({
  timestamps: true,
  collection: 'invitations',
  toJSON: idJsonTransform(),
})
export class Invitation {
  @Prop({ type: Types.ObjectId, ref: 'Booking', required: true, unique: true, index: true })
  booking: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'OrganizerProfile', required: true, index: true })
  organizer: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  customer: Types.ObjectId;

  @Prop({ type: InvitationDetailsSchema, default: () => ({}) })
  details: InvitationDetails;

  @Prop({ type: [InvitationBlockSchema], default: [] })
  blocks: InvitationBlock[];

  /**
   * The Save-the-Date cards, in the order the organizer arranged them. Array
   * order is the display order, so reordering is a write of the whole list —
   * no separate sort key to drift out of step with it.
   */
  @Prop({ type: [InvitationSubEventSchema], default: [] })
  subEvents: InvitationSubEvent[];

  /** The story, in the order the organizer arranged it. */
  @Prop({ type: [InvitationStoryCardSchema], default: [] })
  storyCards: InvitationStoryCard[];

  /** Shared Memories, as the customer configured it. Never organizer-writable. */
  @Prop({ type: InvitationMemoriesSchema, default: () => ({}) })
  memories: InvitationMemories;

  @Prop({ type: [InvitationChangeRequestSchema], default: [] })
  changeRequests: InvitationChangeRequest[];

  @Prop({ type: String, enum: InvitationStatus, default: InvitationStatus.DRAFT, index: true })
  status: InvitationStatus;

  @Prop({ type: Date })
  sentAt?: Date;

  @Prop({ type: Date })
  approvedAt?: Date;

  /*
   * The invitation is reviewed and approved as ONE piece, in versions.
   *
   * `sentContent` is the content as it stood when the organizer last sent it:
   * what the customer reviews. `publishedContent` is the content the customer
   * last approved: what guests see. The organizer's working copy (the fields
   * above) can move on without either changing — guests keep the approved
   * version while an update is drafted, sent and approved.
   *
   * "Content" is the four editable parts: details, blocks, sub-events and the
   * story. Live-stream fields are operational, not content, and are always
   * read from the working copy (see InvitationService.forGuests).
   */
  @Prop({ type: Object, default: null })
  sentContent?: InvitationContent | null;

  @Prop({ type: Object, default: null })
  publishedContent?: InvitationContent | null;

  @Prop({ type: Date })
  publishedAt?: Date;

  /** The organizer has saved edits since they last sent it. */
  @Prop({ default: false })
  hasUnsentChanges: boolean;

  createdAt?: Date;
  updatedAt?: Date;
}

/** The editable parts of an invitation, as one versioned snapshot. */
export interface InvitationContent {
  details: InvitationDetails;
  blocks: InvitationBlock[];
  subEvents: InvitationSubEvent[];
  storyCards: InvitationStoryCard[];
}

export const InvitationSchema = SchemaFactory.createForClass(Invitation);
