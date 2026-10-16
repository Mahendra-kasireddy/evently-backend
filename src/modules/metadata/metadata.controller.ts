import { Body, Controller, Get, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { MetadataService } from './metadata.service';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { Public } from '../../common/decorators/public.decorator';
import { PublicCache } from '../../common/decorators/cache-control.decorator';

/**
 * The app's setup data, as the admin console manages it: the options the
 * planner and organizer registration offer, and the Home/Plan content.
 *
 * Admin-only (class-level guard), as on every other admin surface. Bodies are
 * validated against the type's field list in MetadataService — unknown fields
 * are dropped, and the natural key can never be changed after creation.
 */
@Controller('admin/metadata')
@UseGuards(RolesGuard)
@Roles(Role.ADMIN)
export class AdminMetadataController {
  constructor(private readonly metadata: MetadataService) {}

  /** Every manageable type and its fields — the console builds its forms from this. */
  @Get('types')
  types() {
    return this.metadata.types();
  }

  @Get('content')
  listContent() {
    return this.metadata.listContent();
  }

  @Put('content/:key')
  saveContent(@Param('key') key: string, @Body() body: { data?: unknown }) {
    return this.metadata.saveContent(key, body?.data);
  }

  @Post('content/:key/reset')
  resetContent(@Param('key') key: string) {
    return this.metadata.resetContent(key);
  }

  @Get(':type')
  list(@Param('type') type: string) {
    return this.metadata.list(type);
  }

  @Post(':type')
  create(@Param('type') type: string, @Body() body: Record<string, unknown>) {
    return this.metadata.create(type, body);
  }

  @Patch(':type/:id')
  update(
    @Param('type') type: string,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.metadata.update(type, id, body);
  }
}

/** All active setup options in one public, cacheable call. */
@Controller('metadata')
export class MetadataController {
  constructor(private readonly metadata: MetadataService) {}

  @Public()
  @PublicCache(120, 600)
  @Get('bootstrap')
  bootstrap() {
    return this.metadata.bootstrap();
  }
}
