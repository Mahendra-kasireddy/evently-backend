import { IntersectionType } from '@nestjs/mapped-types';
import { UpdateOrganizerProfileDto } from './update-organizer-profile.dto';
import { UpdateServicesDto } from './update-services.dto';
import { UpdatePortfolioDto } from './update-portfolio.dto';

/**
 * What an admin may fill in on an organizer's behalf.
 *
 * Composed from the organizer's own step DTOs, so admin input is validated by
 * exactly the same rules — there is no second, looser validation path.
 *
 * Deliberately excluded: UpdateVerificationDto (Aadhaar/PAN/GST and their
 * document uploads) and UpdateBankDto (account number, IFSC, cancelled
 * cheque). An admin typing another person's identity or bank details is a
 * fraud vector, and those fields are the ones a verification step exists to
 * confirm. They stay organizer-entered only.
 */
export class AdminUpdateOnboardingDto extends IntersectionType(
  IntersectionType(UpdateOrganizerProfileDto, UpdateServicesDto),
  UpdatePortfolioDto,
) {}
