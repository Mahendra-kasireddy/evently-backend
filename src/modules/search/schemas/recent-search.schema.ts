import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { idJsonTransform } from '../../../common/utils/id-transform';

export type RecentSearchDocument = HydratedDocument<RecentSearch>;

/**
 * Which picker a recent belongs to.
 *
 * Kept separate rather than pooled, because the two lists answer different
 * questions — "which occasions do you plan" and "where are your events" — and
 * a customer opening the area picker should not be offered "Naming ceremony".
 */
export enum RecentSearchKind {
  OCCASION = 'occasion',
  AREA = 'area',
}

/**
 * Something the customer picked in a search screen, remembered for next time.
 *
 * Stored per account rather than on the device so the list follows them to a
 * new phone — the same reason their bookings do.
 *
 * `value` is what the app stores in the draft; `label` is what it shows. They
 * differ for an occasion (id vs name) and are the same for a typed area, and
 * keeping both means a renamed occasion does not strand the recent that
 * pointed at it.
 */
@Schema({
  timestamps: true,
  collection: 'recentsearches',
  toJSON: idJsonTransform(),
})
export class RecentSearch {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  user: Types.ObjectId;

  @Prop({ type: String, enum: RecentSearchKind, required: true })
  kind: RecentSearchKind;

  /** What the customer sees — "Hyderabad", "Naming ceremony". */
  @Prop({ required: true, trim: true })
  label: string;

  /** What the draft stores — an occasion id, or the area text itself. */
  @Prop({ required: true, trim: true })
  value: string;

  createdAt?: Date;
  updatedAt?: Date;
}

export const RecentSearchSchema = SchemaFactory.createForClass(RecentSearch);

/*
 * One row per value per kind per customer: picking Hyderabad twice moves it to
 * the top rather than listing it twice. The upsert in the service relies on
 * this, and the unique index is what makes two simultaneous writes settle on
 * one row instead of racing.
 */
RecentSearchSchema.index({ user: 1, kind: 1, value: 1 }, { unique: true });

/** The read: this customer's recents for one picker, most recent first. */
RecentSearchSchema.index({ user: 1, kind: 1, updatedAt: -1 });
