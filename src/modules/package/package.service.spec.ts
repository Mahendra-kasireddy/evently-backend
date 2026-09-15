import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { PackageService } from './package.service';

/**
 * Photographing a package.
 *
 * The rule worth testing is ownership: an organizer may photograph their own
 * package and nobody else's, and the organizer is read from the session rather
 * than from anything the caller sent. Everything below is a way of trying to
 * get round that.
 *
 * The second rule is that a package without a photo is a normal package — it
 * reports an empty `photoUrl`, and the card draws its occasion illustration.
 */

const USER = new Types.ObjectId();
const OTHER_USER = new Types.ObjectId();
const PROFILE = new Types.ObjectId();
const OTHER_PROFILE = new Types.ObjectId();
const PACKAGE = new Types.ObjectId();

const file = {
  url: '/api/upload/file/packagePhoto/2026/09/x.png',
  key: 'packagePhoto/2026/09/x.png',
  originalName: 'stage.png',
  mimeType: 'image/png',
  size: 1024,
};

/** A package document, owned by PROFILE unless a test says otherwise. */
const pkg = (over: Record<string, unknown> = {}) => ({
  _id: PACKAGE,
  badge: '',
  title: 'Birthday Bash',
  guests: '50–100 guests',
  budget: '₹40K – 80K',
  tags: [],
  art: 'birthday',
  bannerNote: '',
  photo: null as unknown,
  price: 0,
  listPrice: 0,
  organizer: PROFILE,
  save: jest.fn().mockResolvedValue(undefined),
  ...over,
});

/**
 * The service over stubs.
 *
 * `profileForUser` maps a session user id to an organizer profile, which is
 * the only way this service is ever told who the caller is.
 */
function serviceWith(found: ReturnType<typeof pkg> | null, { hasProfile = true } = {}) {
  const packageModel = {
    findById: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(found) }),
    find: jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(found ? [found] : []) }),
    }),
  };

  const organizerModel = {
    findOne: jest.fn().mockReturnValue({
      exec: jest
        .fn()
        .mockResolvedValue(hasProfile ? { _id: PROFILE, name: 'Mahendra Events' } : null),
    }),
    find: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }),
    }),
  };

  const bookingModel = {
    aggregate: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }),
  };

  const service = new PackageService(
    packageModel as never,
    organizerModel as never,
    bookingModel as never,
  );
  return { service, packageModel, organizerModel };
}

describe('an organizer photographing their own package', () => {
  it('stores the file and reports it back on the card', async () => {
    const row = pkg();
    const { service } = serviceWith(row);

    const view = await service.setPhotoForOrganizer(USER.toString(), PACKAGE.toString(), file);

    expect(view.photoUrl).toBe(file.url);
    expect(row.save).toHaveBeenCalledTimes(1);
  });

  it('stamps when it was uploaded, so the record is not silent about it', async () => {
    const row = pkg();
    const { service } = serviceWith(row);

    await service.setPhotoForOrganizer(USER.toString(), PACKAGE.toString(), file);

    expect((row.photo as { uploadedAt?: Date }).uploadedAt).toBeInstanceOf(Date);
  });

  it('reads the organizer from the session, never from the request', async () => {
    // The only argument that decides ownership is the session user id.
    const { service, organizerModel } = serviceWith(pkg());

    await service.setPhotoForOrganizer(USER.toString(), PACKAGE.toString(), file);

    expect(organizerModel.findOne).toHaveBeenCalledWith({ user: USER });
  });

  it('clears the photo when none is given, back to the illustration', async () => {
    const row = pkg({ photo: file });
    const { service } = serviceWith(row);

    const view = await service.setPhotoForOrganizer(USER.toString(), PACKAGE.toString(), null);

    expect(row.photo).toBeNull();
    expect(view.photoUrl).toBe('');
  });
});

describe('an organizer reaching for somebody else’s package', () => {
  it('cannot photograph it, and is not told it exists', async () => {
    /*
     * A 404 rather than a 403: an organizer probing ids should not be able to
     * learn which of them are real. Same rule as the coupon surface.
     */
    const { service } = serviceWith(pkg({ organizer: OTHER_PROFILE }));

    await expect(
      service.setPhotoForOrganizer(OTHER_USER.toString(), PACKAGE.toString(), file),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('writes nothing when it refuses', async () => {
    const row = pkg({ organizer: OTHER_PROFILE });
    const { service } = serviceWith(row);

    await service
      .setPhotoForOrganizer(OTHER_USER.toString(), PACKAGE.toString(), file)
      .catch(() => undefined);

    expect(row.save).not.toHaveBeenCalled();
  });

  it('cannot photograph a package that belongs to nobody yet', async () => {
    // An unassigned package is the admin's to photograph, not any organizer's.
    const { service } = serviceWith(pkg({ organizer: null }));

    await expect(
      service.setPhotoForOrganizer(USER.toString(), PACKAGE.toString(), file),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses a caller who has no organizer profile at all', async () => {
    const { service } = serviceWith(pkg(), { hasProfile: false });

    await expect(
      service.setPhotoForOrganizer(USER.toString(), PACKAGE.toString(), file),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses a malformed session id rather than querying with it', async () => {
    const { service, organizerModel } = serviceWith(pkg());

    await expect(
      service.setPhotoForOrganizer('not-an-id', PACKAGE.toString(), file),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(organizerModel.findOne).not.toHaveBeenCalled();
  });
});

describe('an admin photographing any package', () => {
  it('may photograph one an organizer owns', async () => {
    const row = pkg({ organizer: OTHER_PROFILE });
    const { service } = serviceWith(row);

    const view = await service.setPhotoAsAdmin(PACKAGE.toString(), file);

    expect(view.photoUrl).toBe(file.url);
  });

  it('may photograph one nobody owns', async () => {
    const { service } = serviceWith(pkg({ organizer: null }));
    await expect(service.setPhotoAsAdmin(PACKAGE.toString(), file)).resolves.toMatchObject({
      photoUrl: file.url,
    });
  });

  it('still refuses an id that is not a package', async () => {
    const { service } = serviceWith(null);
    await expect(service.setPhotoAsAdmin(PACKAGE.toString(), file)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('refuses an id that is not an id', async () => {
    const { service } = serviceWith(pkg());
    await expect(service.setPhotoAsAdmin('nonsense', file)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('a package with no photo', () => {
  it('is a normal package, reporting an empty url', async () => {
    // '' is what tells the card to draw its occasion illustration. A package
    // without a photo must never look like a package with a broken one.
    const { service } = serviceWith(pkg({ photo: null }));

    const [view] = await service.listForOrganizer(USER.toString());

    expect(view.photoUrl).toBe('');
    expect(view.art).toBe('birthday');
  });
});
