/**
 * Filing a guest, and importing a phonebook.
 *
 * Two rules worth pinning down: a guest nobody filed is 'other' rather than
 * being guessed into a group, and one unusable number in an import must not
 * lose the other nineteen — a real address book is full of landlines.
 */

import { GuestGroup } from '../schemas/invitation-guest.schema';

/** The default the service applies when a client sends no group. */
function groupFor(sent?: GuestGroup): GuestGroup {
  return sent ?? GuestGroup.OTHER;
}

/** What `addGuests` returns, mirrored: every entry attempted, failures kept apart. */
function importOutcome(entries: Array<{ name: string; ok: boolean }>): {
  added: number;
  skipped: string[];
} {
  const added: string[] = [];
  const skipped: string[] = [];
  for (const entry of entries) {
    if (entry.ok) added.push(entry.name);
    else skipped.push(entry.name);
  }
  return { added: added.length, skipped };
}

describe('a guest’s group', () => {
  it('is whatever the host chose', () => {
    expect(groupFor(GuestGroup.FAMILY)).toBe(GuestGroup.FAMILY);
    expect(groupFor(GuestGroup.WORK)).toBe(GuestGroup.WORK);
  });

  it('is "other" when nobody said, never a guess', () => {
    /*
     * A phonebook does not record whether somebody is family. Defaulting to
     * FAMILY would put a label on the row that the host never chose, and they
     * would have to notice it to correct it.
     */
    expect(groupFor(undefined)).toBe(GuestGroup.OTHER);
  });

  it('offers exactly the three the host files into, plus the unfiled one', () => {
    // Fixed rather than free text: the list exists to be filtered, and free
    // text turns "Friends", "friends" and "College friends" into three chips.
    expect(Object.values(GuestGroup)).toEqual(['family', 'friends', 'work', 'other']);
  });
});

describe('importing several at once', () => {
  it('keeps the good entries when one is unusable', () => {
    const outcome = importOutcome([
      { name: 'Sruthi Reddy', ok: true },
      { name: 'Office landline', ok: false },
      { name: 'Venkat Rao', ok: true },
    ]);
    expect(outcome.added).toBe(2);
    expect(outcome.skipped).toEqual(['Office landline']);
  });

  it('reports what it could not take rather than dropping it quietly', () => {
    /*
     * An import that silently skipped four numbers would leave the host
     * believing everybody in their address book had been added.
     */
    const outcome = importOutcome([{ name: 'Short code', ok: false }]);
    expect(outcome.added).toBe(0);
    expect(outcome.skipped).toHaveLength(1);
  });
});
