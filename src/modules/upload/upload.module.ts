import { Module } from '@nestjs/common';
import { UploadService } from './upload.service';
import { UploadController } from './upload.controller';

/**
 * Reusable, platform-wide file-upload module. Not coupled to any feature —
 * customer, organizer, admin, events, quotes, bookings, reviews and chat can all
 * inject UploadService or POST to /upload. Storage backend is env-configurable
 * (S3-compatible in production, local disk in development).
 */
@Module({
  controllers: [UploadController],
  providers: [UploadService],
  exports: [UploadService],
})
export class UploadModule {}
