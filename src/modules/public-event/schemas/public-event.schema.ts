import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { idJsonTransform } from '../../../common/utils/id-transform';
import {
  EVENT_ADDRESS_MAX,
  EVENT_CATEGORY_MAX,
  EVENT_CITY_MAX,
  EVENT_CONTACT_MAX,
  EVENT_DESCRIPTION_MAX,
  EVENT_TIMEZONE_MAX,
  EVENT_TITLE_MAX,
  EVENT_VENUE_MAX,
  LIVE_URL_MAX,
  LiveAccess,
  MemoryUploaders,
  PublicEventStatus,
} from '../public-event.constants';

export type PublicEventDocument = HydratedDocument<PublicEvent>;

/** Where the event happens, and where that is on a map. */
@Schema({ _id: false })
export class EventVenue {
  @Prop({ trim: true, maxlength: EVENT_VENUE_MAX, default: '' })
  name: string;

  @Prop({ trim: true, maxlength: EVENT_ADDRESS_MAX, default: '' })
  address: string;

  @Prop({ trim: true, maxlength: EVENT_CITY_MAX, default: '' })
  city: string;

  @Prop({ trim: true, maxlength: EVENT_CITY_MAX, default: '' })
  state: string;

  /* Nullable rather than 0: the equator off the coast of Africa is a real
     place, and an event defaulted to it would be drawn there on a map. */
  @Prop({ type: Number, default: null })
  latitude: number | null;

  @Prop({ type: Number, default: null })
  longitude: number | null;
}
export const EventVenueSchema = SchemaFactory.createForClass(EventVenue);

/**
 * The event's shared-memories settings.
 *
 * Only the switches live here. The media itself, the uploads, the renditions
 * and the moderation queue are the existing Shared Memories engine's, reached
 * with this event's id — none of that is reimplemented for public events.
 */
@Schema({ _id: false })
export class EventMemories {
  @Prop({ type: Boolean, default: false })
  enabled: boolean;

  /* Checked-in attendees by default, which is the recommendation for a paid
     event: the people in the room are the ones with photographs of it. */
  @Prop({
    type: String,
    enum: Object.values(MemoryUploaders),
    default: MemoryUploaders.CHECKED_IN,
  })
  uploaders: MemoryUploaders;

  @Prop({ type: Boolean, default: true })
  attendeeView: boolean;

  @Prop({ type: Boolean, default: false })
  attendeeDownload: boolean;

  /** Nothing reaches the gallery until the organizer passes it. */
  @Prop({ type: Boolean, default: false })
  moderation: boolean;

  /** How long after the event uploads are still accepted. */
  @Prop({ type: Number, default: 7, min: 0, max: 365 })
  uploadWindowDays: number;
}
export const EventMemoriesSchema = SchemaFactory.createForClass(EventMemories);

/**
 * The event's live stream.
 *
 * Evently owns who may watch; the URL is whatever embeddable player the
 * organizer uses. The two are deliberately separate fields — entitlement is
 * ours to decide and a provider is theirs to change.
 */
@Schema({ _id: false })
export class EventLiveStream {
  @Prop({ type: Boolean, default: false })
  enabled: boolean;

  @Prop({
    type: String,
    enum: Object.values(LiveAccess),
    default: LiveAccess.TICKETED,
  })
  access: LiveAccess;

  @Prop({ trim: true, maxlength: LIVE_URL_MAX, default: '' })
  url: string;

  /** When the broadcast itself starts and ends — not the event's own times. */
  @Prop({ type: Date, default: null })
  startsAt: Date | null;

  @Prop({ type: Date, default: null })
  endsAt: Date | null;

  /** A recording left up after the stream ends. */
  @Prop({ type: Boolean, default: false })
  replayEnabled: boolean;
}
export const EventLiveStreamSchema = SchemaFactory.createForClass(EventLiveStream);

/**
 * A public event: one an organizer puts on and sells tickets to.
 *
 * Its own collection, deliberately not a Booking with a flag. A booking is a
 * customer hiring an organizer for their wedding; this is an organizer selling
 * seats to strangers. They share almost no fields, no lifecycle and no
 * permissions, and the one place they were nearly folded together is the one
 * place a customer's private wedding could have been listed in a catalogue.
 */
@Schema({ timestamps: true, toJSON: idJsonTransform() })
export class PublicEvent {
  /**
   * The organizer profile that owns this, not the user account.
   *
   * Every organizer-side query is scoped by this field. It is resolved from
   * the authenticated user on the server and never read from the request, so
   * a client cannot name somebody else's organizer and be served their events.
   */
  @Prop({ type: Types.ObjectId, ref: 'OrganizerProfile', required: true, index: true })
  organizer: Types.ObjectId;

  @Prop({ required: true, trim: true, maxlength: EVENT_TITLE_MAX })
  title: string;

  @Prop({ trim: true, maxlength: EVENT_CATEGORY_MAX, default: '' })
  category: string;

  @Prop({ trim: true, maxlength: EVENT_DESCRIPTION_MAX, default: '' })
  description: string;

  /** The cover's URL and storage key, as the shared upload service returns them. */
  @Prop({ trim: true, default: '' })
  coverUrl: string;

  /* The key never leaves the server. It is how the file is reached in storage,
     and a UI that knows it is a UI that can be talked into reaching for
     another one. */
  @Prop({ trim: true, default: '', select: false })
  coverKey: string;

  @Prop({ trim: true, maxlength: EVENT_CONTACT_MAX, default: '' })
  contactName: string;

  @Prop({ trim: true, maxlength: EVENT_CONTACT_MAX, default: '' })
  contactPhone: string;

  @Prop({ trim: true, maxlength: EVENT_CONTACT_MAX, default: '' })
  contactEmail: string;

  @Prop({ type: Date, required: true, index: true })
  startDateTime: Date;

  @Prop({ type: Date, default: null })
  endDateTime: Date | null;

  /** An IANA zone name. The instants above are absolute; this is how to say them. */
  @Prop({ trim: true, maxlength: EVENT_TIMEZONE_MAX, default: 'Asia/Kolkata' })
  timezone: string;

  @Prop({ type: EventVenueSchema, default: () => ({}) })
  venue: EventVenue;

  /** The room's size. 0 means the ticket types are the only limit. */
  @Prop({ type: Number, default: 0, min: 0 })
  capacity: number;

  /** An optional ceiling across all ticket types, per customer. 0 is no ceiling. */
  @Prop({ type: Number, default: 0, min: 0 })
  maxPerCustomer: number;

  @Prop({
    type: String,
    enum: Object.values(PublicEventStatus),
    default: PublicEventStatus.DRAFT,
    index: true,
  })
  status: PublicEventStatus;

  /** Set the first time it is published, and never moved afterwards. */
  @Prop({ type: Date, default: null })
  publishedAt: Date | null;

  @Prop({ type: Date, default: null })
  cancelledAt: Date | null;

  @Prop({ trim: true, maxlength: 500, default: '' })
  cancelReason: string;

  @Prop({ type: EventMemoriesSchema, default: () => ({}) })
  memories: EventMemories;

  @Prop({ type: EventLiveStreamSchema, default: () => ({}) })
  liveStream: EventLiveStream;
}

export const PublicEventSchema = SchemaFactory.createForClass(PublicEvent);

/* An organizer's own list, newest event first — the query behind every screen
   in the organizer's Public Events section. */
PublicEventSchema.index({ organizer: 1, startDateTime: -1 });
/* The catalogue: published events by when they happen. Phase 2 reads this;
   it is declared with the collection so the index exists before it is wanted. */
PublicEventSchema.index({ status: 1, startDateTime: 1 });
