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

// Hard ceiling, a little over the largest per-purpose limit (a 250MB video);
// each purpose's own limit is enforced in the service.
const MAX_UPLOAD_BYTES = 255 * 1024 * 1024;

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
  serve(@Param('0') key: string, @Res() res: Response): void {
    if (!this.uploadService.isLocal) throw new NotFoundException();
    let path: string;
    try {
      path = this.uploadService.localPath(key);
    } catch {
      throw new NotFoundException('File not found');
    }
    const type = CONTENT_TYPES[extname(key).toLowerCase()] ?? 'application/octet-stream';
    /*
     * Streamed from disk with byte ranges, not read into memory and sent whole.
     * iOS will not play a video from a server that cannot answer a Range
     * request, and reading a 250MB reel into memory on every view is how a
     * small instance runs out of it.
     */
    res.sendFile(
      path,
      {
        acceptRanges: true,
        maxAge: '1d',
        headers: { 'Content-Type': type },
      },
      (err?: Error) => {
        if (!err || res.headersSent) return;
        res.status(404).json({ statusCode: 404, message: 'File not found' });
      },
    );
  }
}
