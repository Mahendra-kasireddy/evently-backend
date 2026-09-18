import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SearchService } from './search.service';
import { RecentSearchService } from './recent-search.service';
import { SearchController } from './search.controller';
import { RecentSearch, RecentSearchSchema } from './schemas/recent-search.schema';
import { PackageModule } from '../package/package.module';
import { OrganizerModule } from '../organizer/organizer.module';
import { Package, PackageSchema } from '../package/schemas/package.schema';
import {
  OrganizerProfile,
  OrganizerProfileSchema,
} from '../organizer/schemas/organizer-profile.schema';

/**
 * Customer search. Filters against the collections directly, then hands the
 * matches to the owning services to be mapped — so a search result is byte
 * for byte the same shape as the card it mirrors elsewhere.
 */
@Module({
  imports: [
    PackageModule,
    OrganizerModule,
    MongooseModule.forFeature([
      { name: Package.name, schema: PackageSchema },
      { name: OrganizerProfile.name, schema: OrganizerProfileSchema },
      { name: RecentSearch.name, schema: RecentSearchSchema },
    ]),
  ],
  controllers: [SearchController],
  providers: [SearchService, RecentSearchService],
  exports: [RecentSearchService],
})
export class SearchModule {}
