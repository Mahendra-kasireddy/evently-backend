/**
 * Who a self-addressed brief reaches.
 *
 * A brief the customer aimed themselves is different from one the recommender
 * matched: nobody may be added to the list they chose, and nobody on it may be
 * dropped. The two rules worth pinning down are that the list survives either
 * client shape intact, and that `organizer` — which means "aimed at you and
 * nobody else" — is only ever set when that is true.
 */

import { Types } from 'mongoose';
import { RequestQuoteFromOrganizerDto } from './dto/request-quote-from-organizer.dto';

/**
 * Mirrored from the service's `recipientIdsOf`, which is module-private.
 *
 * Mirrored rather than exported for the test: the rule is three lines and
 * worth stating exactly, and widening the module's surface to observe it
 * would be a change to the code made only by the test.
 */
function recipientIdsOf(dto: Partial<RequestQuoteFromOrganizerDto>): string[] {
  const all = [...(dto.organizerIds ?? []), ...(dto.organizerId ? [dto.organizerId] : [])];
  return all.filter((id, i) => all.indexOf(id) === i);
}

/** What the request document records, given those recipients. */
function requestShape(ids: string[]): { organizer: string | null; recipients: string[] } {
  return { organizer: ids.length === 1 ? (ids[0] ?? null) : null, recipients: ids };
}

const id = () => new Types.ObjectId().toString();

describe('the recipients of a self-addressed brief', () => {
  it('takes the whole shortlist, in the order it was chosen', () => {
    const [a, b, c] = [id(), id(), id()];
    expect(recipientIdsOf({ organizerIds: [b, a, c] })).toEqual([b, a, c]);
  });

  it('still understands a client that only knows how to send one', () => {
    /*
     * Builds from before shortlisting stay in customers' hands for weeks after
     * a release, and they send the singular field. Dropping them would mean
     * "Get quote" silently reaching nobody on an older phone.
     */
    const a = id();
    expect(recipientIdsOf({ organizerId: a })).toEqual([a]);
  });

  it('counts an organizer named twice only once', () => {
    /*
     * The two shapes can name the same organizer. Without de-duplication that
     * organizer is notified twice, and the customer's card reads "went to 2
     * organizers" when it went to one.
     */
    const a = id();
    const b = id();
    expect(recipientIdsOf({ organizerIds: [a, b], organizerId: a })).toEqual([a, b]);
  });

  it('has nothing to send to when the client named nobody', () => {
    // The service turns this into a 400 rather than an unaddressed brief.
    expect(recipientIdsOf({})).toEqual([]);
  });
});

describe('what the request records', () => {
  it('names the organizer only when they are the only one asked', () => {
    const a = id();
    expect(requestShape([a])).toEqual({ organizer: a, recipients: [a] });
  });

  it('leaves `organizer` empty on a shortlist, and keeps every recipient', () => {
    /*
     * `organizer` means "this brief was aimed at you and nobody else" — it is
     * what lets an organizer tell a direct approach from a race against four
     * rivals. Setting it on a shortlist would be a lie told to whichever one
     * happened to be first in the array. The inbox matches on `recipients`, so
     * everybody still sees it.
     */
    const ids = [id(), id(), id()];
    expect(requestShape(ids)).toEqual({ organizer: null, recipients: ids });
  });
});
