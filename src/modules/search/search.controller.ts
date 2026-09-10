import { Controller, Get, Query } from '@nestjs/common';
import { SearchService } from './search.service';
import { SearchQueryDto } from './dto/search-query.dto';
import { Public } from '../../common/decorators/public.decorator';

@Controller('search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

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
}
