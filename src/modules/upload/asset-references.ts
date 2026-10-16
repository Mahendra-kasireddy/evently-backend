/**
 * Where an uploaded file can be referenced from — every collection and field
 * that stores an upload URL or storage key.
 *
 * A file is deleted only when none of these points at it. Keep this list in
 * step with the schemas: a field missing here would make a file look unused
 * while something still shows it. The checker is conservative where it
 * cannot be sure — a lookup that fails counts as "referenced".
 *
 * Plain functions over the MongoDB driver's `Db`, so the API and the cleanup
 * script share exactly the same check.
 */

/** The subset of the MongoDB driver used here (keeps this testable). */
export interface ReferenceDb {
  collection(name: string): {
    findOne(filter: object, options?: object): Promise<unknown>;
    find(filter: object, options?: object): { toArray(): Promise<unknown[]> };
  };
}

/** A stored file's `{url,key}` pair at `base`. */
const file = (base: string) => [`${base}.url`, `${base}.key`];

const ORGANIZER_FILES = [
  'profilePhoto',
  'coverPhoto',
  'gallery',
  'videos',
  'certificates',
  'awards',
  'governmentIdFile',
  'panFile',
  'gstFile',
  'businessRegFile',
  'cancelledChequeFile',
];

/** The invitation's working copy plus the two versions saved from it. */
const INVITATION_PATHS = ['', 'sentContent.', 'publishedContent.'].flatMap((v) => [
  `${v}details.heroMediaUrl`,
  `${v}details.heroMediaKey`,
  `${v}storyCards.imageUrl`,
  `${v}storyCards.imageKey`,
]);

export const REFERENCE_FIELDS: ReadonlyArray<{ collection: string; paths: string[] }> = [
  { collection: 'users', paths: ['photoUrl'] },
  { collection: 'organizer_profiles', paths: ORGANIZER_FILES.flatMap(file) },
  { collection: 'packages', paths: file('photo') },
  { collection: 'plan_occasions', paths: file('image') },
  { collection: 'plan_service_categories', paths: file('image') },
  { collection: 'publicevents', paths: ['coverUrl', 'coverKey'] },
  { collection: 'public_event_memories', paths: ['url', 'storageKey'] },
  { collection: 'invitations', paths: INVITATION_PATHS },
  {
    collection: 'invitation_media',
    paths: ['url', 'storageKey', 'thumbnailUrl', 'thumbnailKey', 'displayUrl', 'displayKey'],
  },
  { collection: 'booking_ideas', paths: file('images') },
  { collection: 'bookings', paths: file('tasks.photoProof') },
];

/** Free-form documents (admin-edited content) — searched as text. */
export const FREEFORM_COLLECTIONS = ['site_content'];

/**
 * Where a file is still used, or `null` if nowhere. Any failed lookup is
 * reported as a reference, so an outage can only ever keep a file.
 */
export async function findReference(
  db: ReferenceDb,
  asset: { url: string; key: string },
): Promise<string | null> {
  const values = [asset.url, asset.key].filter((v) => typeof v === 'string' && v.length > 0);
  if (!values.length) return 'no url or key to check';

  for (const { collection, paths } of REFERENCE_FIELDS) {
    try {
      const hit = await db
        .collection(collection)
        .findOne({ $or: paths.map((p) => ({ [p]: { $in: values } })) }, { projection: { _id: 1 } });
      if (hit) return collection;
    } catch {
      return `${collection} (could not check)`;
    }
  }

  for (const collection of FREEFORM_COLLECTIONS) {
    try {
      const docs = await db.collection(collection).find({}).toArray();
      const text = JSON.stringify(docs);
      if (values.some((v) => text.includes(v))) return collection;
    } catch {
      return `${collection} (could not check)`;
    }
  }
  return null;
}
