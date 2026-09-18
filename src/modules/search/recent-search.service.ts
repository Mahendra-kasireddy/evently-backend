import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  RecentSearch,
  RecentSearchDocument,
  RecentSearchKind,
} from './schemas/recent-search.schema';
import { RecordRecentSearchDto } from './dto/record-recent-search.dto';

/**
 * How many recents one picker keeps.
 *
 * Enough that a customer planning a few events in the same places sees them
 * all, few enough that the list never pushes the full options below the fold —
 * which is the only reason the recents are there.
 */
export const RECENT_SEARCH_LIMIT = 6;

export interface RecentSearchView {
  id: string;
  kind: RecentSearchKind;
  label: string;
  value: string;
}

/**
 * The customer's recent picks in the occasion and area screens.
 *
 * Deliberately not a search log: only a value the customer chose is recorded,
 * never what they typed on the way to it. A half-typed query is not a place
 * they have been, and offering one back is how a list of recents becomes a
 * list of typos.
 */
@Injectable()
export class RecentSearchService {
  constructor(
    @InjectModel(RecentSearch.name)
    private readonly recentModel: Model<RecentSearchDocument>,
  ) {}

  /** One picker's recents, most recently used first. */
  async list(userId: string, kind: RecentSearchKind): Promise<RecentSearchView[]> {
    const rows = await this.recentModel
      .find({ user: new Types.ObjectId(userId), kind })
      .sort({ updatedAt: -1 })
      .limit(RECENT_SEARCH_LIMIT)
      .lean()
      .exec();

    return rows.map((row) => ({
      id: row._id.toString(),
      kind: row.kind,
      label: row.label,
      value: row.value,
    }));
  }

  /**
   * Record a pick.
   *
   * An upsert keyed on the value, so choosing Hyderabad a second time moves it
   * to the top instead of listing it twice — `timestamps` updates `updatedAt`,
   * which is what the list is ordered by. The label is refreshed on the way
   * past, so a renamed occasion stops showing its old name.
   */
  async record(userId: string, dto: RecordRecentSearchDto): Promise<RecentSearchView> {
    const user = new Types.ObjectId(userId);
    const value = dto.value.trim();
    const label = dto.label.trim();

    const saved = await this.recentModel
      .findOneAndUpdate(
        { user, kind: dto.kind, value },
        { $set: { label }, $setOnInsert: { user, kind: dto.kind, value } },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      )
      .exec();

    await this.trim(user, dto.kind);

    return { id: saved._id.toString(), kind: saved.kind, label: saved.label, value: saved.value };
  }

  /** Forget one. Scoped to the owner, so an id alone is not enough to delete it. */
  async remove(userId: string, id: string): Promise<void> {
    if (!Types.ObjectId.isValid(id)) return;
    await this.recentModel
      .deleteOne({ _id: new Types.ObjectId(id), user: new Types.ObjectId(userId) })
      .exec();
  }

  /**
   * Drop anything past the limit.
   *
   * Done on write rather than trimmed at read time, so the collection cannot
   * grow without bound for a customer who plans a lot — the read already
   * limits, but the rows would stay forever.
   */
  private async trim(user: Types.ObjectId, kind: RecentSearchKind): Promise<void> {
    const stale = await this.recentModel
      .find({ user, kind })
      .sort({ updatedAt: -1 })
      .skip(RECENT_SEARCH_LIMIT)
      .select('_id')
      .lean()
      .exec();

    if (stale.length === 0) return;
    await this.recentModel.deleteMany({ _id: { $in: stale.map((row) => row._id) } }).exec();
  }
}
