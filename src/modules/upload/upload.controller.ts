import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { memoryStorage } from 'multer';
import { Response } from 'express';
import { extname } from 'path';

import { UploadService } from './upload.service';
import { UploadFileDto } from './dto/upload-file.dto';
import { UploadedFileMeta } from './interfaces/storage-driver.interface';
import { Public } from '../../common/decorators/public.decorator';

const MAX_UPLOAD_BYTES = 105 * 1024 * 1024; // hard ceiling; per-purpose limit enforced in the service

const CONTENT_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
};

/**
 * Generic upload endpoint, reusable by every module. Requires authentication
 * (inherits the global JwtAuthGuard). Files are received in memory, validated,
 * pushed to the configured storage driver, and only metadata is returned.
 */
@Controller('upload')
export class UploadController {
  constructor(private readonly uploadService: UploadService) {}

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
    }),
  )
  upload(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadFileDto,
  ): Promise<UploadedFileMeta> {
    return this.uploadService.upload(file, dto.purpose);
  }

  /**
   * Dev-only static serving for the local driver. The wildcard captures the
   * full storage key (which contains slashes). Public so <img> tags resolve.
   */
  @Public()
  @Get('file/*')
  async serve(@Param('0') key: string, @Res() res: Response): Promise<void> {
    if (!this.uploadService.isLocal) throw new NotFoundException();
    let buffer: Buffer;
    try {
      buffer = await this.uploadService.readLocal(key);
    } catch {
      throw new NotFoundException('File not found');
    }
    const type = CONTENT_TYPES[extname(key).toLowerCase()] ?? 'application/octet-stream';
    res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(buffer);
  }
}
