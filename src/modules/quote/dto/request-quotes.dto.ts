import { IsArray, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** The hero-draft fields submitted by "Get quotes". */
export class RequestQuotesDto {
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  occasion: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  when?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  where?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  guests?: string;

  // Present when the request originates from the full Plan wizard (absent
  // for the Home hero's quick "Get quotes" draft, which never collects them).
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
