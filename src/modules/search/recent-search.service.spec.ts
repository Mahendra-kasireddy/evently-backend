/**
 * What the pickers remember.
 *
 * The rules that matter are about not wasting the list: one row per place,
 * newest first, capped — a recents list that repeats itself or runs to forty
 * entries is worse than none, because the whole point is to save a search.
 */

import { Types } from 'mongoose';
import { RECENT_SEARCH_LIMIT, RecentSearchService } from './recent-search.service';
import { RecentSearchKind } from './schemas/recent-search.schema';

const USER = new Types.ObjectId().toString();

const row = (over: Record<string, unknown> = {}) => ({
  _id: new Types.ObjectId(),
  user: new Types.ObjectId(USER),
  kind: RecentSearchKind.AREA,
  label: 'Hyderabad',
  value: 'Hyderabad',
  ...over,
});

/** A model stub that records the queries the service builds. */
function modelWith(found: Record<string, unknown>[] = []) {
  const calls: Record<string, unknown[]> = {
    find: [],
    findOneAndUpdate: [],
    deleteMany: [],
    deleteOne: [],
  };

  const chain = (result: unknown) => {
    const link: Record<string, unknown> = {};
    for (const name of ['sort', 'limit', 'skip', 'select', 'lean']) {
      link[name] = jest.fn(() => link);
    }
    link.exec = jest.fn(async () => result);
    return link;
  };

  const model = {
    find: jest.fn((q: unknown) => {
      calls.find.push(q);
      return chain(found);
    }),
    findOneAndUpdate: jest.fn((filter: unknown, update: unknown) => {
      calls.findOneAndUpdate.push({ filter, update });
      return chain(row());
    }),
    deleteMany: jest.fn((q: unknown) => {
      calls.deleteMany.push(q);
      return chain({});
    }),
    deleteOne: jest.fn((q: unknown) => {
      calls.deleteOne.push(q);
      return chain({});
    }),
  };

  return { service: new RecentSearchService(model as never), model, calls };
}

describe('reading a picker’s recents', () => {
  it('asks only for this customer, and only for this picker', () => {
    // An area picker offering "Naming ceremony" is why the two kinds are
    // stored apart rather than pooled.
    const { service, calls } = modelWith();
    void service.list(USER, RecentSearchKind.AREA);

    expect(calls.find[0]).toMatchObject({ kind: RecentSearchKind.AREA });
    expect(String((calls.find[0] as { user: unknown }).user)).toBe(USER);
  });

  it('returns what the screen needs, not the document', () => {
    const { service } = modelWith([row({ label: 'Kukatpally', value: 'Kukatpally' })]);
    return service.list(USER, RecentSearchKind.AREA).then((recents) => {
      expect(recents[0]).toMatchObject({ label: 'Kukatpally', value: 'Kukatpally' });
      expect(typeof recents[0].id).toBe('string');
    });
  });
});

describe('recording a pick', () => {
  it('moves a repeat to the top rather than listing it twice', async () => {
    // Keyed on the value, so the second Hyderabad updates the first row —
    // `timestamps` refreshes updatedAt, which is what the list sorts by.
    const { service, calls } = modelWith();
    await service.record(USER, {
      kind: RecentSearchKind.AREA,
      label: 'Hyderabad',
      value: 'Hyderabad',
    });

    const { filter, update } = calls.findOneAndUpdate[0] as {
      filter: Record<string, unknown>;
      update: Record<string, unknown>;
    };
    expect(filter).toMatchObject({ kind: RecentSearchKind.AREA, value: 'Hyderabad' });
    expect(update).toHaveProperty('$set', { label: 'Hyderabad' });
  });

  it('trims what is entered, so " Hyderabad " is not a second place', async () => {
    const { service, calls } = modelWith();
    await service.record(USER, {
      kind: RecentSearchKind.AREA,
      label: '  Hyderabad  ',
      value: '  Hyderabad  ',
    });

    const { filter } = calls.findOneAndUpdate[0] as { filter: Record<string, unknown> };
    expect(filter.value).toBe('Hyderabad');
  });

  it('drops anything past the limit', async () => {
    // Trimmed on write, not at read: the read already limits, but the rows
    // would otherwise stay forever for a customer who plans a lot.
    const stale = [row(), row()];
    const { service, calls, model } = modelWith(stale);
    await service.record(USER, {
      kind: RecentSearchKind.AREA,
      label: 'Hyderabad',
      value: 'Hyderabad',
    });

    expect(model.find).toHaveBeenCalled();
    expect(calls.deleteMany).toHaveLength(1);
    expect(RECENT_SEARCH_LIMIT).toBeGreaterThan(0);
  });

  it('deletes nothing when the customer is under the limit', async () => {
    const { service, calls } = modelWith([]);
    await service.record(USER, {
      kind: RecentSearchKind.OCCASION,
      label: 'Wedding',
      value: 'wedding',
    });
    expect(calls.deleteMany).toHaveLength(0);
  });
});

describe('forgetting one', () => {
  it('will not delete another account’s row on a guessed id', async () => {
    const id = new Types.ObjectId().toString();
    const { service, calls } = modelWith();
    await service.remove(USER, id);

    const filter = calls.deleteOne[0] as { user: unknown };
    expect(String(filter.user)).toBe(USER);
  });

  it('ignores an id that is not one', async () => {
    const { service, calls } = modelWith();
    await service.remove(USER, 'not-an-id');
    expect(calls.deleteOne).toHaveLength(0);
  });
});
