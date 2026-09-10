import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { OfferService } from './offer.service';
import { UpsertOfferDto } from './dto/upsert-offer.dto';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';

/**
 * Admin-only offer management.
 *
 * The class-level @Roles(Role.ADMIN) + RolesGuard is the authorization, as on
 * every other admin controller here: it runs on all four routes, so a customer
 * or a guest hitting these URLs directly gets 403 whatever any client renders.
 * The console's own role gate is convenience on top of this, never a substitute.
 */
@Controller('admin/offer')
@UseGuards(RolesGuard)
@Roles(Role.ADMIN)
export class AdminOfferController {
  constructor(private readonly offerService: OfferService) {}

  /** Every offer, including expired ones — the admin has to see those too. */
  @Get('getOffers')
  getOffers() {
    return this.offerService.listAll();
  }

  @Post('createOffer')
  createOffer(@Body() dto: UpsertOfferDto) {
    return this.offerService.create(dto);
  }

  @Patch('updateOffer/:id')
  updateOffer(@Param('id') id: string, @Body() dto: UpsertOfferDto) {
    return this.offerService.update(id, dto);
  }

  @Delete('deleteOffer/:id')
  deleteOffer(@Param('id') id: string) {
    return this.offerService.remove(id);
  }
}
