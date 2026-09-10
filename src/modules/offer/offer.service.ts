import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Offer, OfferDocument } from './schemas/offer.schema';
import { UpsertOfferDto } from './dto/upsert-offer.dto';

/** An offer as a customer sees it — no window, no switches, just the card. */
export interface PublicOfferView {
  id: string;
  eyebrow: string;
  title: string;
  terms: string;
  ctaLabel: string;
  tone: string;
  /** '' when the offer does not expire; otherwise "Ends 30 September". */
  endsLabel: string;
}

@Injectable()
export class OfferService {
  constructor(@InjectModel(Offer.name) private readonly offerModel: Model<OfferDocument>) {}

  /**
   * The offers that are live at this moment.
   *
   * Filtered on the window in the query rather than trusting `active` alone:
   * an offer whose end date has passed is off the moment it passes, whether or
   * not anyone remembered to switch it. `$or` with null covers the two open
   * cases — no start means always started, no end means never ends.
   */
  async findLive(): Promise<PublicOfferView[]> {
    const now = new Date();
    const offers = await this.offerModel
      .find({
        active: true,
        $and: [
          { $or: [{ startsAt: null }, { startsAt: { $lte: now } }] },
          { $or: [{ endsAt: null }, { endsAt: { $gte: now } }] },
        ],
      })
      .sort({ order: 1, createdAt: -1 })
      .exec();

    return offers.map((offer) => this.toPublicView(offer));
  }

  private toPublicView(offer: OfferDocument): PublicOfferView {
    return {
      id: offer._id.toString(),
      eyebrow: offer.eyebrow,
      title: offer.title,
      terms: offer.terms ?? '',
      ctaLabel: offer.ctaLabel || 'See details',
      tone: offer.tone,
      endsLabel: offer.endsAt
        ? `Ends ${offer.endsAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}`
        : '',
    };
  }

  // ---------------------------------------------------------------------------
  // Admin
  // ---------------------------------------------------------------------------

  /** Everything, live or not — the admin needs to see what is expired too. */
  listAll(): Promise<OfferDocument[]> {
    return this.offerModel.find().sort({ order: 1, createdAt: -1 }).exec();
  }

  create(dto: UpsertOfferDto): Promise<OfferDocument> {
    return this.offerModel.create(this.toDocument(dto));
  }

  async update(id: string, dto: UpsertOfferDto): Promise<OfferDocument> {
    this.assertObjectId(id);
    const updated = await this.offerModel
      .findByIdAndUpdate(id, this.toDocument(dto), { new: true })
      .exec();
    if (!updated) throw new NotFoundException('Offer not found');
    return updated;
  }

  async remove(id: string): Promise<{ removed: true }> {
    this.assertObjectId(id);
    const deleted = await this.offerModel.findByIdAndDelete(id).exec();
    if (!deleted) throw new NotFoundException('Offer not found');
    return { removed: true };
  }

  /**
   * An absent date means "open-ended" and must be stored as null, not left
   * untouched — otherwise clearing an end date on an existing offer would
   * silently keep the old one and the offer would expire anyway.
   */
  private toDocument(dto: UpsertOfferDto): Record<string, unknown> {
    return {
      ...dto,
      startsAt: dto.startsAt ? new Date(dto.startsAt) : null,
      endsAt: dto.endsAt ? new Date(dto.endsAt) : null,
    };
  }

  private assertObjectId(id: string): void {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Offer not found');
  }
}
