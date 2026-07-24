import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { OrganizerService } from './organizer.service';
import { OrganizerConfigService } from './organizer-config.service';
import { OrganizerOnboardingService } from './organizer-onboarding.service';
import { UpdateOrganizerProfileDto } from './dto/update-organizer-profile.dto';
import { UpdateVerificationDto } from './dto/update-verification.dto';
import { UpdateBankDto } from './dto/update-bank.dto';
import { UpdateServicesDto } from './dto/update-services.dto';
import { UpdatePortfolioDto } from './dto/update-portfolio.dto';
import { Public } from '../../common/decorators/public.decorator';
import { PublicCache } from '../../common/decorators/cache-control.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('organizer')
export class OrganizerController {
  constructor(
    private readonly organizerService: OrganizerService,
    private readonly configService: OrganizerConfigService,
    private readonly onboardingService: OrganizerOnboardingService,
  ) {}

  // ---------------------------------------------------------------------------
  // Public — customer-facing discovery (existing)
  // ---------------------------------------------------------------------------

  /** Home "Top organizers near you" cards. */
  @Public()
  @PublicCache(60, 300)
  @Get('getTopOrganizers')
  getTopOrganizers(@Query('limit') limit?: string) {
    const n = limit ? Math.min(parseInt(limit, 10) || 6, 50) : 6;
    return this.organizerService.findTop(n);
  }

  /** Organizer profile detail ("View Profile"). */
  @Public()
  @PublicCache(60, 300)
  @Get('getOrganizerById/:id')
  getOrganizerById(@Param('id') id: string) {
    return this.organizerService.findById(id);
  }

  // ---------------------------------------------------------------------------
  // Public — onboarding dropdown config (dynamic, from MongoDB)
  // ---------------------------------------------------------------------------

  /** Step 1 dropdowns: business types, categories, cities. */
  @Public()
  @PublicCache(120, 600)
  @Get('onboarding-config')
  getOnboardingConfig() {
    return this.configService.getOnboardingConfig();
  }

  /** Step 4 dropdowns: experience, team sizes, languages, travel, payment, days, occasions, categories. */
  @Public()
  @PublicCache(120, 600)
  @Get('services-config')
  getServicesConfig() {
    return this.configService.getServicesConfig();
  }

  // ---------------------------------------------------------------------------
  // Authenticated — organizer registration & onboarding (owner-scoped)
  // ---------------------------------------------------------------------------

  /** Upgrade the current (OTP-verified) user to an organizer + create a draft profile. */
  @Throttle({ default: { limit: 10, ttl: 600_000 } })
  @Post('register')
  register(@CurrentUser('userId') userId: string) {
    return this.onboardingService.register(userId);
  }

  /** The current user's organizer profile (resume draft). */
  @Get('profile')
  getProfile(@CurrentUser('userId') userId: string) {
    return this.onboardingService.getProfile(userId);
  }

  /** Autosave/update Step-1 (Basic Information) fields. */
  @Patch('profile')
  updateProfile(@CurrentUser('userId') userId: string, @Body() dto: UpdateOrganizerProfileDto) {
    return this.onboardingService.updateProfile(userId, dto);
  }

  /** Step 2 — Verification. */
  @Patch('profile/verification')
  updateVerification(@CurrentUser('userId') userId: string, @Body() dto: UpdateVerificationDto) {
    return this.onboardingService.updateVerification(userId, dto);
  }

  /** Step 3 — Bank details. */
  @Patch('profile/bank')
  updateBank(@CurrentUser('userId') userId: string, @Body() dto: UpdateBankDto) {
    return this.onboardingService.updateBank(userId, dto);
  }

  /** Step 4 — Services. */
  @Patch('profile/services')
  updateServices(@CurrentUser('userId') userId: string, @Body() dto: UpdateServicesDto) {
    return this.onboardingService.updateServices(userId, dto);
  }

  /** Step 5 — Portfolio. */
  @Patch('profile/portfolio')
  updatePortfolio(@CurrentUser('userId') userId: string, @Body() dto: UpdatePortfolioDto) {
    return this.onboardingService.updatePortfolio(userId, dto);
  }

  /** Onboarding status + step completion. */
  @Get('onboarding-status')
  getOnboardingStatus(@CurrentUser('userId') userId: string) {
    return this.onboardingService.getOnboardingStatus(userId);
  }

  /** Profile completion % + missing fields. */
  @Get('profile-completion')
  getProfileCompletion(@CurrentUser('userId') userId: string) {
    return this.onboardingService.getProfileCompletion(userId);
  }

  /** Submit the profile for verification. */
  @HttpCode(HttpStatus.OK)
  @Post('complete-onboarding')
  completeOnboarding(@CurrentUser('userId') userId: string) {
    return this.onboardingService.completeOnboarding(userId);
  }
}
