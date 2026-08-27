import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UserService } from './user.service';
import { AdminUserService } from './admin-user.service';
import { UserController } from './user.controller';
import { AdminUserController } from './admin-user.controller';
import { User, UserSchema } from './schemas/user.schema';
import { Booking, BookingSchema } from '../booking/schemas/booking.schema';
import { QuoteRequest, QuoteRequestSchema } from '../quote/schemas/quote-request.schema';
import { PlanSubmission, PlanSubmissionSchema } from '../plan/schemas/plan-submission.schema';

/**
 * The booking / quote / plan schemas are registered here (not their modules)
 * so the admin account screen can count a user's activity without importing
 * services that already depend on UserService — that would be a cycle.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Booking.name, schema: BookingSchema },
      { name: QuoteRequest.name, schema: QuoteRequestSchema },
      { name: PlanSubmission.name, schema: PlanSubmissionSchema },
    ]),
  ],
  controllers: [UserController, AdminUserController],
  providers: [UserService, AdminUserService],
  exports: [UserService],
})
export class UserModule {}
