/**
 * What the story is when a client reads it back.
 *
 * Two rules worth pinning down, because both fail silently. The order the
 * organizer arranged has to survive the trip whatever order the cards come out
 * of storage in — a story told backwards is not an error anyone gets told
 * about — and the storage handle behind each photograph must never leave with
 * a guest's copy.
 */

import { Types } from 'mongoose';
import { storyView } from './story.view';
import type { InvitationDocument } from './schemas/invitation.schema';

type Card = {
  _id: Types.ObjectId;
  imageUrl: string;
  imageKey: string;
  caption: string;
  order: number;
};

const card = (over: Partial<Card> = {}): Card => ({
  _id: new Types.ObjectId(),
  imageUrl: '/api/upload/file/story/one.jpg',
  imageKey: 'story/one.jpg',
  caption: 'Where our story began',
  order: 0,
  ...over,
});

/** Only the field `storyView` reads; the rest of the document is irrelevant. */
const withCards = (storyCards: Card[]) => ({ storyCards }) as unknown as InvitationDocument;

describe('the story a client reads back', () => {
  it('tells it in the organizer’s order, not the order it was stored in', () => {
    const view = storyView(
      withCards([
        card({ caption: 'third', order: 2 }),
        card({ caption: 'first', order: 0 }),
        card({ caption: 'second', order: 1 }),
      ]),
    );
    expect(view.map((c) => c.caption)).toEqual(['first', 'second', 'third']);
  });

  it('never hands a guest the storage handle behind a photograph', () => {
    const [only] = storyView(withCards([card()]));
    expect(only.imageUrl).toBe('/api/upload/file/story/one.jpg');
    expect(only).not.toHaveProperty('imageKey');
  });

  it('gives the editor the handle it needs to replace a photograph', () => {
    const [only] = storyView(withCards([card()]), { withKeys: true });
    expect(only.imageKey).toBe('story/one.jpg');
  });

  it('carries an id per card, so a list has a key that survives reordering', () => {
    const cards = [card({ order: 0 }), card({ order: 1 })];
    const ids = storyView(withCards(cards)).map((c) => c.id);
    expect(ids).toEqual([cards[0]._id.toString(), cards[1]._id.toString()]);
  });

  it('is empty, not absent, when no story has been written', () => {
    // The guest renderer decides visibility from the count, so it must get one.
    expect(storyView(withCards([]))).toEqual([]);
  });
});
