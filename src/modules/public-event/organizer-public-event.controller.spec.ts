import 'reflect-metadata';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { OrganizerPublicEventController } from './organizer-public-event.controller';

/**
 * The isolation boundary, asserted from the controller's own metadata rather
 * than from reading it.
 *
 * These are the checks that do not survive a refactor on their own: a route
 * added in a hurry under the wrong prefix, a guard that quietly stops covering
 * a new handler, an organizer id that creeps into a path because it was
 * convenient. Each of those is a way one organizer reaches another's event,
 * and none of them looks wrong in a diff.
 */
const proto = OrganizerPublicEventController.prototype;
const handlers = Object.getOwnPropertyNames(proto).filter((name) => name !== 'constructor');

const pathOf = (name: string): string =>
  (Reflect.getMetadata(PATH_METADATA, proto[name as keyof typeof proto] as object) as string) ?? '';

describe('the organizer public-event controller', () => {
  it('serves every route under one organizer-scoped prefix', () => {
    expect(Reflect.getMetadata(PATH_METADATA, OrganizerPublicEventController)).toBe(
      'public-event/organizer',
    );
  });

  it('is shut to anybody who is not an organizer', () => {
    const roles = Reflect.getMetadata(ROLES_KEY, OrganizerPublicEventController) as Role[];
    expect(roles).toEqual(expect.arrayContaining([Role.ORGANIZER, Role.ADMIN]));
    expect(roles).not.toContain(Role.CUSTOMER);
    expect(roles).not.toContain(Role.VENDOR);
  });

  it('has the handlers the organizer screens need, and no more', () => {
    expect(handlers.sort()).toEqual(
      [
        'archiveTicketType',
        'attendees',
        'changeStatus',
        'checkIn',
        'create',
        'createTicketType',
        'dashboard',
        'findOne',
        'list',
        'listTicketTypes',
        'setLiveStream',
        'setMemories',
        'listMemories',
        'approveMemory',
        'rejectMemory',
        'update',
        'updateTicketType',
      ].sort(),
    );
  });

  /*
   * The important one. Ownership is resolved from the session, so an organizer
   * id in a path or a query would be a second, client-supplied answer to the
   * same question — and the client's answer is the one an attacker controls.
   */
  it('never takes an organizer id from the caller', () => {
    for (const name of handlers) {
      expect(pathOf(name)).not.toMatch(/organizer(Id)?/i);
    }
  });

  it('scopes everything below the list to one event id from the path', () => {
    const collectionRoutes = ['list', 'create'];
    for (const name of handlers) {
      if (collectionRoutes.includes(name)) continue;
      expect(pathOf(name)).toMatch(/^:eventId/);
    }
  });

  /*
   * Admitting somebody changes the world. A GET that does is one a browser,
   * a proxy or a link preview is free to repeat on its own.
   */
  it('admits through a POST, never a GET', () => {
    const method = Reflect.getMetadata(METHOD_METADATA, proto.checkIn as object) as number;
    // RequestMethod.POST
    expect(method).toBe(1);
  });

  it('reads through GET and writes through anything but', () => {
    const readers = ['list', 'findOne', 'listTicketTypes', 'dashboard', 'attendees'];
    for (const name of readers) {
      expect(
        Reflect.getMetadata(METHOD_METADATA, proto[name as keyof typeof proto] as object),
      ).toBe(0);
    }
  });
});
