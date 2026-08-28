import { Transform } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/**
 * What a sub-vendor may change about their own profile.
 *
 * `category` and `fullName` are deliberately absent, and their absence is the
 * control: the global pipe runs with `whitelist: true`, which strips
 * properties not declared on the DTO but does not filter declared ones, and
 * the service passes the validated DTO straight through. Category drives the
 * rate-card unit, organizer matching and the admin roster filters, so changing
 * it after the fact would silently reprice existing agreements — it stays an
 * onboarding-time decision.
 */
export class UpdateSubVendorProfileDto {
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(120)
  serviceArea?: string;

  /** Rupees. 0 clears the rate rather than meaning "free". */
  @IsOptional()
  @Transform(({ value }) => (value === '' || value === null ? undefined : Number(value)))
  @IsInt({ message: 'Enter a whole rupee amount' })
  @Min(0)
  @Max(10_000_000, { message: 'That rate looks too high — check the figure' })
  baseRate?: number;

  @IsOptional()
  @Transform(({ value }) => (value === '' || value === null ? undefined : Number(value)))
  @IsInt({ message: 'Enter a whole number' })
  @Min(0)
  @Max(1_000_000)
  minOrder?: number;

  /**
   * Whether the vendor is taking work. Organizers' vendor pickers already
   * respect this flag; until now only an admin could set it, so a vendor who
   * was fully booked or away had no way to stop being assigned jobs.
   */
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
