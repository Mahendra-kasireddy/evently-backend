/**
 * Who is allowed to reach Shared Memories at all.
 *
 * Read off the controller's own metadata rather than asserted in prose,
 * because this is the one property of F6 that is easy to break by accident and
 * impossible to see in review: adding a convenience route for the organizer,
 * or forgetting a guard on a new customer action, both look like ordinary
 * additions in a diff.
 */

import 'reflect-metadata';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { MemoriesController } from './memories.controller';
import { ROLES_KEY } from '../../../common/decorators/roles.decorator';
import { IS_PUBLIC_KEY } from '../../../common/decorators/public.decorator';
import { Role } from '../../../common/enums/role.enum';

interface Route {
  name: string;
  path: string;
  /** 'GET' | 'POST' | 'DELETE' | … , from Nest's own request-method metadata. */
  method: string;
  roles: Role[] | undefined;
  isPublic: boolean;
}

/** Nest stores the verb as an index into this order. */
const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'ALL', 'OPTIONS', 'HEAD', 'SEARCH'];

/** Every handler on the controller, with what decorates it. */
function routes(): Route[] {
  const proto = MemoriesController.prototype as unknown as Record<string, unknown>;
  return Object.getOwnPropertyNames(proto)
    .filter((name) => name !== 'constructor' && typeof proto[name] === 'function')
    .filter((name) => Reflect.hasMetadata(METHOD_METADATA, proto[name] as object))
    .map((name) => {
      const handler = proto[name] as object;
      return {
        name,
        path: (Reflect.getMetadata(PATH_METADATA, handler) as string) ?? '',
        method: METHODS[Reflect.getMetadata(METHOD_METADATA, handler) as number] ?? '',
        roles: Reflect.getMetadata(ROLES_KEY, handler) as Role[] | undefined,
        isPublic: Reflect.getMetadata(IS_PUBLIC_KEY, handler) === true,
      };
    });
}

const all = routes();
const guestRoutes = all.filter((r) => r.path.startsWith('shared/'));
const customerRoutes = all.filter((r) => r.path.startsWith('mine/'));
const organizerRoutes = all.filter((r) => r.path.startsWith('organizer/'));

/** Everything that decides what happens to somebody's photographs. */
const CONTROL = ['settings', 'approve', 'reject', 'hide', 'show', 'awaiting'];

describe('the shape of the controller', () => {
  it('has routes, and every one belongs to exactly one audience', () => {
    expect(all.length).toBeGreaterThan(0);
    expect(guestRoutes.length + customerRoutes.length + organizerRoutes.length).toBe(all.length);
  });
});

describe('what the organizer may reach', () => {
  /*
   * The boundary moved, and this is where it now sits. An organizer is at the
   * celebration with a camera, so their photographs belong in the gallery —
   * but whether the gallery exists, who may download from it, and what is
   * approved or deleted are decisions about the customer's own photographs.
   *
   * The guarantee is still the absence of routes rather than the presence of
   * guards: an endpoint that does not exist cannot be reached by a mistake in
   * a role list or a future refactor of one.
   */
  it('may add a memory and read the gallery, and nothing else', () => {
    expect(organizerRoutes.map((r) => r.path).sort()).toEqual([
      'organizer/:bookingId/memories',
      'organizer/:bookingId/memories',
    ]);
  });

  it('has no route to the settings, the queue, or deletion', () => {
    for (const route of organizerRoutes) {
      for (const word of CONTROL) {
        expect(route.path).not.toContain(word);
      }
    }
    // And nothing organizer-facing deletes.
    expect(organizerRoutes.filter((r) => r.method === 'DELETE')).toEqual([]);
  });

  it('never names the organizer on a customer route', () => {
    const leaked = customerRoutes.filter((r) => (r.roles ?? []).includes(Role.ORGANIZER));
    expect(leaked.map((r) => r.name)).toEqual([]);
  });

  it('is restricted to the organizer role, and never public', () => {
    for (const route of organizerRoutes) {
      expect(route.isPublic).toBe(false);
      expect(route.roles).toContain(Role.ORGANIZER);
      expect(route.roles).not.toContain(Role.CUSTOMER);
    }
  });
});

describe('the customer routes', () => {
  it('cover the whole of the customer’s control surface', () => {
    const paths = customerRoutes.map((r) => r.path).sort();
    expect(paths).toEqual(
      [
        /* GET, the management gallery. */
        'mine/:bookingId/memories',
        /* POST, the host adding one from their own phone. */
        'mine/:bookingId/memories',
        'mine/:bookingId/memories/:mediaId',
        'mine/:bookingId/memories/:mediaId/approve',
        'mine/:bookingId/memories/:mediaId/hide',
        'mine/:bookingId/memories/:mediaId/reject',
        'mine/:bookingId/memories/:mediaId/show',
        'mine/:bookingId/memories/awaiting',
        'mine/:bookingId/memories/settings',
        'mine/:bookingId/memories/settings',
      ].sort(),
    );
  });

  it('are all restricted to the customer, and never public', () => {
    for (const route of customerRoutes) {
      expect(route.isPublic).toBe(false);
      expect(route.roles).toContain(Role.CUSTOMER);
      expect(route.roles).not.toContain(Role.ORGANIZER);
      expect(route.roles).not.toContain(Role.VENDOR);
    }
  });
});

describe('the guest routes', () => {
  it('are public, because the spec forbids guest login', () => {
    // The token in the path is the credential; the service resolves identity
    // from it and takes nothing else from the caller.
    for (const route of guestRoutes) {
      expect(route.isPublic).toBe(true);
      expect(route.roles).toBeUndefined();
    }
  });

  it('never carry a booking id, so no guest can name an event', () => {
    /*
     * Which invitation a guest is looking at comes from their token. A route
     * taking a bookingId would be one a guest could point at another wedding.
     */
    for (const route of guestRoutes) {
      expect(route.path).not.toContain(':bookingId');
    }
  });
});
