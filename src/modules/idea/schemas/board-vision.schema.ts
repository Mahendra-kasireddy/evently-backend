import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { idJsonTransform } from '../../../common/utils/id-transform';

export type BoardVisionDocument = HydratedDocument<BoardVision>;

/**
 * What the organizer has understood the event to be — the short version, in the
 * customer's own terms.
 *
 * One per booking. The organizer writes it from the ideas the customer has
 * shared; the customer reads it back and can tell at a glance whether they have
 * been heard. Every slot is optional and starts empty: an unfilled slot is
 * rendered as "not captured yet", never as a guess.
 */
@Schema({
  timestamps: true,
  collection: 'board_visions',
  toJSON: idJsonTransform(),
})
export class BoardVision {
  @Prop({ type: Types.ObjectId, ref: 'Booking', required: true, unique: true, index: true })
  booking: Types.ObjectId;

  /** Look and colour — "Marigold & maroon". */
  @Prop({ trim: true, default: '', maxlength: 120 })
  theme: string;

  /** How the day should feel — "Traditional + fun". */
  @Prop({ trim: true, default: '', maxlength: 120 })
  vibe: string;

  /** Something planned to stay unannounced. */
  @Prop({ trim: true, default: '', maxlength: 120 })
  surprise: string;

  /** Catering direction — "Veg-forward + live counters". */
  @Prop({ trim: true, default: '', maxlength: 120 })
  food: string;

  /**
   * Whether the surprise is being kept off anything the customer shares
   * onward. Mirrors an idea's own `confidential` flag, and is what puts the
   * lock on that row.
   */
  @Prop({ default: true })
  surpriseConfidential: boolean;

  createdAt?: Date;
  updatedAt?: Date;
}

export const BoardVisionSchema = SchemaFactory.createForClass(BoardVision);
