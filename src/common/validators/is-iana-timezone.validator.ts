import { registerDecorator, type ValidationOptions } from 'class-validator';

/**
 * True for a zone the runtime actually knows, e.g. `Asia/Kolkata`.
 *
 * Asked of the platform's own zone database rather than matched against a
 * pattern: `Foo/Bar` looks exactly like a zone name and would sail through a
 * regex, then silently break every countdown computed against it.
 */
export function isIanaTimeZone(value: unknown): boolean {
  if (typeof value !== 'string' || value.trim() === '') return false;
  try {
    // Throws RangeError on an unknown zone.
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

export function IsIanaTimeZone(options?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      name: 'isIanaTimeZone',
      target: object.constructor,
      propertyName,
      ...(options ? { options } : {}),
      validator: {
        validate: (value: unknown) => isIanaTimeZone(value),
        defaultMessage: () => 'timezone must be a valid IANA zone, e.g. Asia/Kolkata',
      },
    });
  };
}
