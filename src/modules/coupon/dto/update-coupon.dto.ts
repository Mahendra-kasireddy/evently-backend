import { OmitType, PartialType } from '@nestjs/mapped-types';
import { CouponTermsDto } from './coupon-terms.dto';

/**
 * Editing a live coupon.
 *
 * The code is not editable. Customers have already been given it, and
 * redemptions reference it by name — renaming it would rewrite history that
 * the ledger has already recorded.
 */
export class UpdateCouponDto extends PartialType(OmitType(CouponTermsDto, ['code'] as const)) {}
