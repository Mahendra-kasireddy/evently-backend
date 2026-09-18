import { IsEnum, IsString, MaxLength, MinLength } from 'class-validator';
import { RecentSearchKind } from '../schemas/recent-search.schema';

/** POST /search/recents — the customer picked something worth remembering. */
export class RecordRecentSearchDto {
  @IsEnum(RecentSearchKind)
  kind: RecentSearchKind;

  /*
   * 120 matches the quote request's `where`, which is the longest thing that
   * can end up here: an Indian locality plus its city runs well past the 60
   * these fields were first bounded at.
   */
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  label: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  value: string;
}
