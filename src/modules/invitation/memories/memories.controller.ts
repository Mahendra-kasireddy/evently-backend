import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { memoryStorage } from 'multer';
import { MemoriesService } from './memories.service';
import { MemoriesSettingsDto } from '../dto/memories-settings.dto';
import { UploadMemoryDto } from '../dto/upload-memory.dto';
import { GalleryQueryDto } from '../dto/gallery-query.dto';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Public } from '../../../common/decorators/public.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Role } from '../../../common/enums/role.enum';

/** The ceiling the interceptor enforces; the per-purpose limit is the service's. */
const MAX_MEMORY_BYTES = 105 * 1024 * 1024;

/**
 * Shared Memories.
 *
 * Two audiences on one feature, and they are separated by route prefix rather
 * than by a flag inside a handler: `shared/:token/...` is a guest holding a
 * share link, `mine/:bookingId/...` is the customer who owns the celebration.
 * There is no organizer prefix here at all — the gallery is the customer's
 * guests photographing the customer's wedding, so the organizer has no part in
 * it, and the absence of a route is a stronger guarantee than a guard on one.
 */
@Controller('invitation')
export class MemoriesController {
  constructor(private readonly memories: MemoriesService) {}

  /* ---------------------------------------------------------------- guests */

  /**
   * A guest adding a memory.
   *
   * Public because the spec forbids guest login, so the token in the path is
   * the credential — and it is the only thing trusted: which invitation, which
   * guest and whether they may upload at all are resolved from it. Throttled
   * per client, because an open upload route is otherwise somewhere to put
   * a hundred megabytes at a time.
   */
  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('shared/:token/memories')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_MEMORY_BYTES, files: 1 },
    }),
  )
  add(
    @Param('token') token: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadMemoryDto,
  ) {
    return this.memories.upload(token, file, dto);
  }

  /** The uploader saying a flagged photograph of theirs is fine as it is. */
  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('shared/:token/memories/:mediaId/keep')
  keep(@Param('token') token: string, @Param('mediaId') mediaId: string) {
    return this.memories.override(token, mediaId);
  }

  @Public()
  @Get('shared/:token/memories')
  gallery(@Param('token') token: string, @Query() query: GalleryQueryDto) {
    return this.memories.gallery(token, query);
  }

  /** One item, with the ids either side of it for the viewer's arrows. */
  @Public()
  @Get('shared/:token/memories/:mediaId')
  item(@Param('token') token: string, @Param('mediaId') mediaId: string) {
    return this.memories.item(token, mediaId);
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('shared/:token/memories/:mediaId/like')
  like(@Param('token') token: string, @Param('mediaId') mediaId: string) {
    return this.memories.like(token, mediaId, true);
  }

  @Public()
  @Delete('shared/:token/memories/:mediaId/like')
  unlike(@Param('token') token: string, @Param('mediaId') mediaId: string) {
    return this.memories.like(token, mediaId, false);
  }

  /**
   * A download, which exists only if the customer allowed one.
   *
   * The permission is decided here and the url is in the answer only when it
   * passes, so hiding the button is a courtesy rather than the control.
   */
  @Public()
  @Get('shared/:token/memories/:mediaId/download')
  download(@Param('token') token: string, @Param('mediaId') mediaId: string) {
    return this.memories.download(token, mediaId);
  }

  /* ------------------------------------------------------------ organizers */

  /**
   * The organizer adding a memory to a celebration they run, and reading the
   * gallery.
   *
   * These two and no others. There is deliberately no organizer route to the
   * settings, the moderation queue or deletion: whether the gallery exists,
   * who may download from it and what gets removed are decisions about the
   * customer's own photographs. The absence of those routes is the guarantee,
   * and `memories.controller.spec.ts` asserts it.
   */
  @UseGuards(RolesGuard)
  @Roles(Role.ORGANIZER, Role.ADMIN)
  @Throttle({ default: { limit: 40, ttl: 60_000 } })
  @Post('organizer/:bookingId/memories')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_MEMORY_BYTES, files: 1 },
    }),
  )
  addAsOrganizer(
    @CurrentUser('userId') userId: string,
    @Param('bookingId') bookingId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadMemoryDto,
  ) {
    return this.memories.uploadAsOrganizer(userId, bookingId, file, dto);
  }

  @UseGuards(RolesGuard)
  @Roles(Role.ORGANIZER, Role.ADMIN)
  @Get('organizer/:bookingId/memories')
  organizerGallery(
    @CurrentUser('userId') userId: string,
    @Param('bookingId') bookingId: string,
    @Query() query: GalleryQueryDto,
  ) {
    return this.memories.organizerGallery(userId, bookingId, query);
  }

  /* ------------------------------------------------------------- customers */

  @UseGuards(RolesGuard)
  @Roles(Role.CUSTOMER, Role.ADMIN)
  @Get('mine/:bookingId/memories/settings')
  settings(@CurrentUser('userId') userId: string, @Param('bookingId') bookingId: string) {
    return this.memories.settings(userId, bookingId);
  }

  @UseGuards(RolesGuard)
  @Roles(Role.CUSTOMER, Role.ADMIN)
  @Patch('mine/:bookingId/memories/settings')
  saveSettings(
    @CurrentUser('userId') userId: string,
    @Param('bookingId') bookingId: string,
    @Body() dto: MemoriesSettingsDto,
  ) {
    return this.memories.saveSettings(userId, bookingId, dto);
  }

  /**
   * The customer adding a memory from their own phone.
   *
   * Their own login is the credential — they are the one person at the
   * celebration with an account. Everything past the ownership check is the
   * guest pipeline, unchanged: same duplicate checks, same quality checks,
   * same renditions, same moderation.
   */
  @UseGuards(RolesGuard)
  @Roles(Role.CUSTOMER, Role.ADMIN)
  @Throttle({ default: { limit: 40, ttl: 60_000 } })
  @Post('mine/:bookingId/memories')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_MEMORY_BYTES, files: 1 },
    }),
  )
  addAsHost(
    @CurrentUser('userId') userId: string,
    @Param('bookingId') bookingId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadMemoryDto,
  ) {
    return this.memories.uploadAsHost(userId, bookingId, file, dto);
  }

  /** The customer's management gallery: everything on their invitation. */
  @UseGuards(RolesGuard)
  @Roles(Role.CUSTOMER, Role.ADMIN)
  @Get('mine/:bookingId/memories')
  manage(
    @CurrentUser('userId') userId: string,
    @Param('bookingId') bookingId: string,
    @Query() query: GalleryQueryDto,
  ) {
    return this.memories.manage(userId, bookingId, query);
  }

  /** Out of the gallery, reversibly — the step short of deleting. */
  @UseGuards(RolesGuard)
  @Roles(Role.CUSTOMER, Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @Post('mine/:bookingId/memories/:mediaId/hide')
  hide(
    @CurrentUser('userId') userId: string,
    @Param('bookingId') bookingId: string,
    @Param('mediaId') mediaId: string,
  ) {
    return this.memories.setHidden(userId, bookingId, mediaId, true);
  }

  @UseGuards(RolesGuard)
  @Roles(Role.CUSTOMER, Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @Post('mine/:bookingId/memories/:mediaId/show')
  show(
    @CurrentUser('userId') userId: string,
    @Param('bookingId') bookingId: string,
    @Param('mediaId') mediaId: string,
  ) {
    return this.memories.setHidden(userId, bookingId, mediaId, false);
  }

  @UseGuards(RolesGuard)
  @Roles(Role.CUSTOMER, Role.ADMIN)
  @Get('mine/:bookingId/memories/awaiting')
  awaiting(@CurrentUser('userId') userId: string, @Param('bookingId') bookingId: string) {
    return this.memories.awaiting(userId, bookingId);
  }

  @UseGuards(RolesGuard)
  @Roles(Role.CUSTOMER, Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @Post('mine/:bookingId/memories/:mediaId/approve')
  approve(
    @CurrentUser('userId') userId: string,
    @Param('bookingId') bookingId: string,
    @Param('mediaId') mediaId: string,
  ) {
    return this.memories.moderate(userId, bookingId, mediaId, true);
  }

  @UseGuards(RolesGuard)
  @Roles(Role.CUSTOMER, Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @Post('mine/:bookingId/memories/:mediaId/reject')
  reject(
    @CurrentUser('userId') userId: string,
    @Param('bookingId') bookingId: string,
    @Param('mediaId') mediaId: string,
  ) {
    return this.memories.moderate(userId, bookingId, mediaId, false);
  }

  @UseGuards(RolesGuard)
  @Roles(Role.CUSTOMER, Role.ADMIN)
  @Delete('mine/:bookingId/memories/:mediaId')
  remove(
    @CurrentUser('userId') userId: string,
    @Param('bookingId') bookingId: string,
    @Param('mediaId') mediaId: string,
  ) {
    return this.memories.remove(userId, bookingId, mediaId);
  }
}
