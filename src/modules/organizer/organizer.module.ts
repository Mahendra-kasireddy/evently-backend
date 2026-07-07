import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { OrganizerService } from './organizer.service';
import { OrganizerController } from './organizer.controller';
import { OrganizerProfile, OrganizerProfileSchema } from './schemas/organizer-profile.schema';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: OrganizerProfile.name, schema: OrganizerProfileSchema }]),
  ],
  controllers: [OrganizerController],
  providers: [OrganizerService],
  exports: [OrganizerService],
})
export class OrganizerModule {}
