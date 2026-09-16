import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Address, AddressDocument, AddressLabel } from './schemas/address.schema';
import { CreateAddressDto } from './dto/create-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';

/** A saved address, plus how far it is from wherever the customer asked. */
export interface AddressWithDistance {
  distanceMeters?: number;
}

@Injectable()
export class AddressService {
  constructor(
    @InjectModel(Address.name) private readonly addressModel: Model<AddressDocument>,
  ) {}

  /**
   * The customer's saved addresses.
   *
   * Given a point to measure from, the list comes back nearest-first with a
   * distance on each — that is the "Home | 4km" in the list, and it is computed
   * by Mongo through the 2dsphere index rather than by fetching everything and
   * measuring on the device. Without a point there is nothing to measure from,
   * so the list falls back to newest-first and carries no distances: an absent
   * number is better than one measured from an assumed location.
   */
  async listForUser(
    userId: string,
    near?: { latitude: number; longitude: number },
  ): Promise<unknown[]> {
    const user = new Types.ObjectId(userId);

    if (!near) {
      const docs = await this.addressModel.find({ user }).sort({ createdAt: -1 }).exec();
      return docs.map((doc) => doc.toJSON());
    }

    /*
     * $geoNear has to be the first stage of the pipeline, so the per-customer
     * filter rides along in its own `query` option rather than a later $match —
     * otherwise the sort would be computed across every customer's addresses
     * and then thrown away.
     */
    return this.addressModel
      .aggregate([
        {
          $geoNear: {
            near: { type: 'Point', coordinates: [near.longitude, near.latitude] },
            distanceField: 'distanceMeters',
            spherical: true,
            query: { user },
          },
        },
      ])
      .exec();
  }

  async create(userId: string, dto: CreateAddressDto): Promise<unknown> {
    const user = new Types.ObjectId(userId);

    /* The first address a customer saves is the one they meant, so it is the
       default without being asked — an empty book has no other candidate. */
    const existing = await this.addressModel.countDocuments({ user }).exec();
    const isDefault = dto.isDefault ?? existing === 0;

    if (isDefault) await this.clearDefault(user);

    const created = await this.addressModel.create({
      ...this.toDocumentShape(dto),
      user,
      isDefault,
    });

    return created.toJSON();
  }

  async update(userId: string, addressId: string, dto: UpdateAddressDto): Promise<unknown> {
    const user = new Types.ObjectId(userId);
    const address = await this.findOwned(user, addressId);

    if (dto.isDefault === true) await this.clearDefault(user);

    Object.assign(address, this.toDocumentShape(dto));
    if (dto.isDefault !== undefined) address.isDefault = dto.isDefault;

    await address.save();
    return address.toJSON();
  }

  async remove(userId: string, addressId: string): Promise<{ id: string }> {
    const user = new Types.ObjectId(userId);
    const address = await this.findOwned(user, addressId);
    const wasDefault = address.isDefault;

    await address.deleteOne();

    /*
     * Deleting the default leaves the customer with addresses and none chosen,
     * which reads on screen as nothing being selected. The most recent of what
     * is left takes over — a guess, but a better one than an empty selection,
     * and one the customer can change in a tap.
     */
    if (wasDefault) {
      const next = await this.addressModel.findOne({ user }).sort({ createdAt: -1 }).exec();
      if (next) {
        next.isDefault = true;
        await next.save();
      }
    }

    return { id: addressId };
  }

  /** Marks one address as the chosen one, unmarking whichever held it before. */
  async setDefault(userId: string, addressId: string): Promise<unknown> {
    const user = new Types.ObjectId(userId);
    const address = await this.findOwned(user, addressId);

    await this.clearDefault(user);
    address.isDefault = true;
    await address.save();

    return address.toJSON();
  }

  private async findOwned(user: Types.ObjectId, addressId: string): Promise<AddressDocument> {
    /*
     * The owner is part of the lookup, not a check after it. Fetching by id and
     * then comparing would answer a probe for someone else's address with a
     * different error than a missing one, which is enough to enumerate them.
     */
    if (!Types.ObjectId.isValid(addressId)) throw new NotFoundException('Address not found');

    const address = await this.addressModel.findOne({ _id: addressId, user }).exec();
    if (!address) throw new NotFoundException('Address not found');
    return address;
  }

  private async clearDefault(user: Types.ObjectId): Promise<void> {
    await this.addressModel.updateMany({ user, isDefault: true }, { isDefault: false }).exec();
  }

  /** Flips the caller's latitude/longitude into the GeoJSON order Mongo wants. */
  private toDocumentShape(dto: CreateAddressDto | UpdateAddressDto): Record<string, unknown> {
    const { coordinates, isDefault: _isDefault, ...rest } = dto;

    if (!coordinates) return { ...rest };

    return {
      ...rest,
      location: {
        type: 'Point' as const,
        coordinates: [coordinates.longitude, coordinates.latitude],
      },
    };
  }

  /** Convenience for other modules: the address a booking should default to. */
  async findDefault(userId: string): Promise<AddressDocument | null> {
    return this.addressModel
      .findOne({ user: new Types.ObjectId(userId), isDefault: true })
      .exec();
  }
}

export { AddressLabel };
