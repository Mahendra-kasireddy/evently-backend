import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UploadService } from './upload.service';
import { UploadController } from './upload.controller';
import { AssetLifecycleService } from './asset-lifecycle.service';
import { MediaAsset, MediaAssetSchema } from './schemas/media-asset.schema';

/**
 * Reusable, platform-wide file-upload module. Not coupled to any feature —
 * customer, organizer, admin, events, quotes, bookings, reviews and chat can all
 * inject UploadService or POST to /upload. Storage backend is env-configurable
 * (Cloudinary in production, local disk in development).
 *
 * AssetLifecycleService deletes files a flow has stopped using, safely — see
 * that class for the rules.
 */
@Module({
  imports: [MongooseModule.forFeature([{ name: MediaAsset.name, schema: MediaAssetSchema }])],
  controllers: [UploadController],
  providers: [UploadService, AssetLifecycleService],
  exports: [UploadService, AssetLifecycleService],
})
export class UploadModule {}
