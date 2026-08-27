import { IsArray, IsMongoId, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** The hero-draft fields submitted by "Get quotes". */
export class RequestQuotesDto {
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  occasion: string;

  /**
   * The plan submission this request was raised from, so My Events can show
   * the plan, the responses and the eventual booking as one event rather than
   * three. Absent for the hero's quick draft, which has no plan document.
   */
  @IsOptional()
  @IsMongoId()
  planId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  when?: string;

  /**
   * "Area, City", composed by the Plan wizard from two free-text fields.
   *
   * 60 was too tight for what those two fields legitimately hold — an Indian
   * locality alone can run past it ("Nanakramguda, Financial District,
   * Gachibowli" is 48 before the city is added), and the request failed only
   * after the plan had already been saved. 120 fits the pair with room to
   * spare; the client caps both inputs so this bound is never the first thing
   * the customer hears about.
   */
  @IsOptional()
  @IsString()
  @MaxLength(120)
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
