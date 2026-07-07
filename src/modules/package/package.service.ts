import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Package, PackageDocument } from './schemas/package.schema';

@Injectable()
export class PackageService {
  constructor(@InjectModel(Package.name) private readonly packageModel: Model<PackageDocument>) {}

  /** Active packages for the home carousel, in display order. */
  findActive(): Promise<PackageDocument[]> {
    return this.packageModel.find({ active: true }).sort({ order: 1, createdAt: 1 }).exec();
  }

  async findById(id: string): Promise<PackageDocument> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Package not found');
    const pkg = await this.packageModel.findById(id).exec();
    if (!pkg) throw new NotFoundException('Package not found');
    return pkg;
  }
}
