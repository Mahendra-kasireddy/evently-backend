import { UploadModule } from '../upload/upload.module';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UserService } from './user.service';
import { AdminUserService } from './admin-user.service';
import { UserController } from './user.controller';
import { AdminUserController } from './admin-user.controller';
import { AdminTeamService } from './admin-team.service';
import { AdminTeamController } from './admin-team.controller';
import { AdminInvite, AdminInviteSchema } from './schemas/admin-invite.schema';
import { User, UserSchema } from './schemas/user.schema';
import { Booking, BookingSchema } from '../booking/schemas/booking.schema';
import { QuoteRequest, QuoteRequestSchema } from '../quote/schemas/quote-request.schema';
import { PlanSubmission, PlanSubmissionSchema } from '../plan/schemas/plan-submission.schema';
import { Package, PackageSchema } from '../package/schemas/package.schema';

/**
 * The booking / quote / plan schemas are registered here (not their modules)
 * so the admin account screen can count a user's activity without importing
 * services that already depend on UserService — that would be a cycle.
 */
@Module({
  imports: [
    UploadModule,
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: AdminInvite.name, schema: AdminInviteSchema },
      { name: Booking.name, schema: BookingSchema },
      { name: QuoteRequest.name, schema: QuoteRequestSchema },
      { name: PlanSubmission.name, schema: PlanSubmissionSchema },
      // Registered here rather than importing PackageModule: the saved list
      // only reads package documents, and the schema is all that needs.
      { name: Package.name, schema: PackageSchema },
    ]),
  ],
  controllers: [UserController, AdminUserController, AdminTeamController],
  providers: [UserService, AdminUserService, AdminTeamService],
  exports: [UserService, AdminTeamService],
})
export class UserModule {}
