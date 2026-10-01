import 'reflect-metadata';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { CustomerPublicEventController } from './customer-public-event.controller';
import { OrganizerPublicEventController } from './organizer-public-event.controller';
import { BrowsePublicEventsDto, StartEventBookingDto } from './dto/customer-public-event.dto';

/**
 * The customer boundary, asserted from metadata rather than from reading it.
 *
 * Three things here do not survive a refactor on their own: a route that
 * quietly becomes open, a catalogue filter that learns to take a status, and a
 * price that creeps into a purchase DTO. Each is a way the catalogue starts
 * showing drafts or the customer starts naming their own total, and none of
 * them looks wrong in a diff.
 */
const proto = CustomerPublicEventController.prototype;
const handlers = Object.getOwnPropertyNames(proto).filter((n) => n !== 'constructor');
const handler = (name: string) => proto[name as keyof typeof proto] as object;
const pathOf = (name: string): string =>
  (Reflect.getMetadata(PATH_METADATA, handler(name)) as string) ?? '';
const isOpen = (name: string): boolean =>
  Reflect.getMetadata(IS_PUBLIC_KEY, handler(name)) === true;

describe('the customer public-event controller', () => {
  it('is a separate controller from the organizer’s', () => {
    // Same audience, same file, one forgotten branch — that is the whole risk.
    expect(CustomerPublicEventController).not.toBe(OrganizerPublicEventController);
    expect(Reflect.getMetadata(PATH_METADATA, CustomerPublicEventController)).toBe('public-event');
  });

  it('carries no organizer role, so it can never be reached as one', () => {
    expect(Reflect.getMetadata(ROLES_KEY, CustomerPublicEventController)).toBeUndefined();
  });

  /*
   * Exactly two routes are open to the world: the catalogue and one event's
   * page. Anything that costs money or names a person needs a session, and the
   * list below is what fails if a third ever quietly joins them.
   */
  it('opens the catalogue and nothing else', () => {
    const open = handlers.filter(isOpen).sort();
    expect(open).toEqual(['browse', 'detail']);
  });

  /*
   * The detail page is public, but must still read the session when one is
   * sent: whether you hold a ticket — and so may see the gallery or watch the
   * stream — is worked out from it. Without the optional guard the global one
   * skips @Public routes entirely and every customer arrives anonymous.
   */
  it('reads the session on the open detail page when there is one', () => {
    const guards = (Reflect.getMetadata('__guards__', handler('detail')) ?? []) as unknown[];
    expect(guards).toContain(OptionalJwtAuthGuard);
  });

  it('keeps buying, confirming and ticket routes behind a session', () => {
    for (const name of ['book', 'confirm', 'myTickets', 'ticket']) {
      expect(isOpen(name)).toBe(false);
    }
  });

  it('buys and confirms through POST, and reads through GET', () => {
    // RequestMethod: GET 0, POST 1.
    expect(Reflect.getMetadata(METHOD_METADATA, handler('book'))).toBe(1);
    expect(Reflect.getMetadata(METHOD_METADATA, handler('confirm'))).toBe(1);
    expect(Reflect.getMetadata(METHOD_METADATA, handler('browse'))).toBe(0);
    expect(Reflect.getMetadata(METHOD_METADATA, handler('myTickets'))).toBe(0);
  });

  it('never takes a customer or organizer id from the caller', () => {
    for (const name of handlers) {
      expect(pathOf(name)).not.toMatch(/customer(Id)?|organizer(Id)?/i);
    }
  });
});

describe('what a customer may ask for', () => {
  /*
   * The catalogue decides for itself which events are visible. A status field
   * here — however innocently added for a "filter by sold out" chip — would be
   * a client-supplied answer to that question.
   */
  it('offers no way to ask the catalogue for a status', () => {
    const asked = Object.keys(new BrowsePublicEventsDto());
    const declared = ['q', 'category', 'city', 'lat', 'lng', 'radiusKm', 'sort', 'limit', 'page'];
    for (const key of [...asked, ...declared]) {
      expect(key).not.toMatch(/status|draft|visib/i);
    }
  });

  /*
   * A purchase names a ticket type and a count. The price is read from the
   * ticket type on the server, so the DTO has nowhere to put one — and the
   * validation pipe runs with `whitelist: true`, which strips anything a
   * client sends that is not declared.
   */
  it('offers no way to send a price, a total or a discount', () => {
    const dto = new StartEventBookingDto();
    const keys = [...Object.keys(dto), 'ticketTypeId', 'quantity'];
    for (const key of keys) {
      expect(key).not.toMatch(/price|amount|total|discount|currency/i);
    }
  });
});
