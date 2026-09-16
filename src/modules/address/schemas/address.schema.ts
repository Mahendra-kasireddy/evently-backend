import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { idJsonTransform } from '../../../common/utils/id-transform';

export type AddressDocument = HydratedDocument<Address>;

/** What the customer calls this place. Drives the icon and the list heading. */
export enum AddressLabel {
  HOME = 'home',
  WORK = 'work',
  OTHER = 'other',
}

/**
 * A place the customer has saved, as they described it.
 *
 * Two halves that must not be confused. The map's answer — `formattedAddress`,
 * `area`, `city`, `location` — is what the geocoder said about the pin, and it
 * is reliable down to about a building. The customer's answer — `houseNumber`,
 * `building`, `landmark` — is everything a geocoder cannot know and a delivery
 * depends on: which floor, which block, the shop to turn at. The form asks for
 * the second because the first is never enough, and neither overwrites the
 * other.
 */
@Schema({
  timestamps: true,
  collection: 'addresses',
  toJSON: idJsonTransform(),
})
export class Address {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  user: Types.ObjectId;

  @Prop({ type: String, enum: AddressLabel, default: AddressLabel.OTHER, index: true })
  label: AddressLabel;

  /**
   * What the customer typed when they chose "Other".
   *
   * Empty for Home and Work, which name themselves. Kept separate from `label`
   * so the icon and the filtering stay driven by the enum while the heading can
   * still read "Mum's place".
   */
  @Prop({ trim: true, default: '', maxlength: 60 })
  customLabel: string;

  // ----- The customer's own detail, which no map can supply -----

  @Prop({ trim: true, required: true, maxlength: 120 })
  houseNumber: string;

  @Prop({ trim: true, default: '', maxlength: 120 })
  building: string;

  @Prop({ trim: true, default: '', maxlength: 160 })
  landmark: string;

  // ----- The map's answer for the pin -----

  /** The one-line address the geocoder returned, shown under the heading. */
  @Prop({ trim: true, required: true, maxlength: 400 })
  formattedAddress: string;

  /** The locality the pin fell in — "Hitech City". */
  @Prop({ trim: true, default: '', maxlength: 120 })
  area: string;

  @Prop({ trim: true, default: '', maxlength: 120 })
  city: string;

  @Prop({ trim: true, default: '', maxlength: 120 })
  state: string;

  @Prop({ trim: true, default: '', maxlength: 12 })
  pincode: string;

  /**
   * GeoJSON, so `[longitude, latitude]` — the opposite order to every screen
   * that displays it, and the order MongoDB requires for a 2dsphere index.
   * That index is what lets the saved list be sorted by distance from wherever
   * the customer is standing, rather than fetching every address and measuring
   * them on the device.
   */
  @Prop({
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point',
    },
    coordinates: { type: [Number], required: true },
    _id: false,
  })
  location: { type: 'Point'; coordinates: [number, number] };

  // ----- Who is receiving -----

  @Prop({ trim: true, required: true, maxlength: 120 })
  receiverName: string;

  @Prop({ trim: true, required: true, maxlength: 20 })
  receiverPhone: string;

  /**
   * The address used unless the customer picks another — the "Selected" tag.
   *
   * At most one per customer. Enforced in the service rather than by a unique
   * index, because a partial unique index on `{ user, isDefault: true }` would
   * reject the intermediate state of moving the flag between two documents.
   */
  @Prop({ default: false })
  isDefault: boolean;

  createdAt?: Date;
  updatedAt?: Date;
}

export const AddressSchema = SchemaFactory.createForClass(Address);

AddressSchema.index({ location: '2dsphere' });
/* The saved list is always "this customer's addresses, newest first". */
AddressSchema.index({ user: 1, createdAt: -1 });
