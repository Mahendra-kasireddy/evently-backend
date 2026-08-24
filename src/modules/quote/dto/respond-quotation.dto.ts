import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

class QuotationSubItemDto {
  @IsString()
  @MaxLength(120)
  label: string;

  @IsString()
  @MaxLength(120)
  value: string;
}

export class QuotationLineDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  key?: string;

  @IsString()
  @MaxLength(120)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  subtitle?: string;

  @IsNumber()
  @Min(0)
  price: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuotationSubItemDto)
  subItems?: QuotationSubItemDto[];
}

/** Organizer's priced response to a quote request. */
export class RespondQuotationDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuotationLineDto)
  lineItems: QuotationLineDto[];

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  taxRate?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  advancePercentage?: number;

  @IsOptional()
  @IsBoolean()
  siteVisitSuggested?: boolean;

  /**
   * `true` parks the quotation as a private draft (the customer never sees it
   * and gets no notification); `false`/omitted sends it. On update, passing
   * `false` for a draft is what promotes it to sent.
   */
  @IsOptional()
  @IsBoolean()
  asDraft?: boolean;
}
