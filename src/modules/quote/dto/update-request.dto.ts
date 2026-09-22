import { IsArray, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * A revision of a brief the customer already sent.
 *
 * Every field is optional — the customer may be changing one row of the four —
 * and the bounds match {@link RequestQuotesDto} exactly, so a brief cannot be
 * edited into a shape it could not have been created in.
 *
 * Deliberately absent: `planId` and the recipient list. Editing changes what
 * is being asked for, never who it was asked of or which plan it belongs to.
 */
export class UpdateRequestDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  occasion?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  when?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  where?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  guests?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  budget?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  categories?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  ideas?: string;
}
