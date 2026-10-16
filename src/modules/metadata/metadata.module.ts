import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Content, ContentSchema } from '../content/schemas/content.schema';
import { AdminMetadataController, MetadataController } from './metadata.controller';
import { MetadataService } from './metadata.service';
import { METADATA_TYPES } from './metadata.registry';

/**
 * Setup data: the planner's and organizer registration's options, and the
 * Home/Plan content. The data stays in each type's own collection; this module
 * registers their schemas so it can manage them all through one API.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Content.name, schema: ContentSchema },
      ...METADATA_TYPES.map((t) => ({
        name: t.modelName,
        schema: t.schema as never,
      })),
    ]),
  ],
  controllers: [AdminMetadataController, MetadataController],
  providers: [MetadataService],
})
export class MetadataModule {}
