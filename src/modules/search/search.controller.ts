import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { SearchService } from './search.service';
import { RecentSearchService } from './recent-search.service';
import { SearchQueryDto } from './dto/search-query.dto';
import { RecordRecentSearchDto } from './dto/record-recent-search.dto';
import { RecentSearchKind } from './schemas/recent-search.schema';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';

@Controller('search')
export class SearchController {
  constructor(
    private readonly searchService: SearchService,
    private readonly recentSearchService: RecentSearchService,
  ) {}

  /**
   * Packages and organizers matching a query.
   *
   * Public, because everything it returns is already public — the package
   * carousel and organizer profiles are visible to a signed-out visitor, and
   * requiring a session to search what is on the shelf would only stop people
   * finding out whether the platform serves their city. Deliberately not
   * cached: unlike the config endpoints, the query string is the customer's
   * own words, and a per-query CDN entry buys nothing.
   */
  @Public()
  @Get()
  search(@Query() query: SearchQueryDto) {
    return this.searchService.search(query);
  }

  // ----- Recent picks, for the occasion and area screens -----

  /*
   * These three are NOT public: a recent is the customer's own history, and
   * the only account it can be read or written for is the one in the token.
   */

  /** What this customer last picked in one of the pickers. */
  @Get('recents/:kind')
  recents(@CurrentUser('userId') userId: string, @Param('kind') kind: RecentSearchKind) {
    return this.recentSearchService.list(userId, kind);
  }

  /** Remember a pick. Choosing the same thing again moves it to the top. */
  @Post('recents')
  recordRecent(@CurrentUser('userId') userId: string, @Body() dto: RecordRecentSearchDto) {
    return this.recentSearchService.record(userId, dto);
  }

  /** Forget one. */
  @Delete('recents/:id')
  removeRecent(@CurrentUser('userId') userId: string, @Param('id') id: string) {
    return this.recentSearchService.remove(userId, id);
  }
}
