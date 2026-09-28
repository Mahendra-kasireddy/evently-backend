import { registerDecorator, type ValidationOptions } from 'class-validator';
import {
  LIVE_EMBED_HOSTS,
  isEmbeddableStreamUrl,
} from '../../modules/invitation/invitation-defaults';

/**
 * True for `''` (no stream) or an https url on a player host we allow.
 *
 * The allowlist itself lives with the other invitation constants; this is the
 * decorator that puts it in front of the DTO. Empty passes because clearing a
 * stream is done by sending an empty string, not by omitting the field — an
 * omitted field would mean "leave it alone", and there would then be no way to
 * turn a stream url off.
 */
export function IsEmbeddableStreamUrl(options?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      name: 'isEmbeddableStreamUrl',
      target: object.constructor,
      propertyName,
      ...(options ? { options } : {}),
      validator: {
        validate: (value: unknown) =>
          typeof value === 'string' && (value.trim() === '' || isEmbeddableStreamUrl(value.trim())),
        defaultMessage: () =>
          `a stream url must be https and hosted by one of: ${LIVE_EMBED_HOSTS.join(', ')}`,
      },
    });
  };
}
