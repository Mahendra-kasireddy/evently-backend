import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ContentDocument = HydratedDocument<Content>;

/**
 * Generic CMS content store: one document per page/section, keyed by a stable
 * string. `data` holds the editable copy blob (flexible shape) so marketing
 * text can change without a code deploy.
 */
@Schema({
  timestamps: true,
  collection: 'site_content',
  toJSON: {
    transform: (_doc, ret: Record<string, unknown>) => {
      delete ret._id;
      delete ret.__v;
      return ret;
    },
  },
})
export class Content {
  @Prop({ required: true, unique: true, index: true })
  key: string;

  @Prop({ type: Object, default: {} })
  data: Record<string, unknown>;
}

export const ContentSchema = SchemaFactory.createForClass(Content);
