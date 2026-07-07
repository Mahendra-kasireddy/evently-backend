import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

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
}
