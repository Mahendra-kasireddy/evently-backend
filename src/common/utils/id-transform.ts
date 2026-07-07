/**
 * Shared Mongoose `toJSON` options: expose `id`, drop `_id`/`__v`, and hide any
 * sensitive fields. Replaces the identical transform copy-pasted in every
 * entity schema.
 *
 *   @Schema({ toJSON: idJsonTransform() })                       // entities
 *   @Schema({ toJSON: idJsonTransform('passwordHash') })         // + hidden fields
 */
export function idJsonTransform(...hidden: string[]) {
  return {
    virtuals: true,
    transform: (_doc: unknown, ret: Record<string, unknown>) => {
      ret.id = ret._id;
      delete ret._id;
      delete ret.__v;
      for (const field of hidden) delete ret[field];
      return ret;
    },
  };
}
