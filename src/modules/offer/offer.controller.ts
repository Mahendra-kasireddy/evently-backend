import { Controller, Get } from '@nestjs/common';
import { OfferService } from './offer.service';
import { Public } from '../../common/decorators/public.decorator';
import { PublicCache } from '../../common/decorators/cache-control.decorator';

@Controller('offer')
export class OfferController {
  constructor(private readonly offerService: OfferService) {}

  /**
   * The offers live right now.
   *
   * Public and cacheable: an offer is the same for everyone, carries nothing
   * about the person reading it, and is exactly the sort of thing a CDN should
   * be allowed to hold. The short max-age keeps an expiry from lingering.
   */
  @Public()
  @PublicCache(60, 300)
  @Get('live')
  findLive() {
    return this.offerService.findLive();
  }
}
