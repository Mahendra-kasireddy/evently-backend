import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { BullModule } from '@nestjs/bullmq';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import configuration from './config/configuration';
import { envValidationSchema } from './config/env.validation';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { LoggingInterceptor } from './common/utils/logging.interceptor';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { AuthModule } from './modules/auth/auth.module';
import { UserModule } from './modules/user/user.module';
import { PlanEventModule } from './modules/plan-event/plan-event.module';
import { PackageModule } from './modules/package/package.module';
import { OrganizerModule } from './modules/organizer/organizer.module';
import { BookingModule } from './modules/booking/booking.module';
import { ContentModule } from './modules/content/content.module';
import { NotificationModule } from './modules/notification/notification.module';
import { QuoteModule } from './modules/quote/quote.module';
import { HomeModule } from './modules/home/home.module';
import { PlanModule } from './modules/plan/plan.module';
import { UploadModule } from './modules/upload/upload.module';
import { SubvendorModule } from './modules/subvendor/subvendor.module';
import { InvitationModule } from './modules/invitation/invitation.module';
import { IdeaModule } from './modules/idea/idea.module';
import { ContactModule } from './modules/contact/contact.module';
import { AdminModule } from './modules/admin/admin.module';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';

@Module({
  imports: [
    // Global typed + validated config
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: [configuration],
      validationSchema: envValidationSchema,
      validationOptions: { abortEarly: true },
    }),

    // MongoDB
    DatabaseModule,

    // Redis 7 + BullMQ (shared connection for all queues/processors)
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get<string>('redis.host'),
          port: config.get<number>('redis.port'),
          password: config.get<string>('redis.password'),
          db: config.get<number>('redis.db'),
        },
        prefix: config.get<string>('redis.prefix'),
      }),
    }),

    // Rate limiting — 100 req / 60s per IP by default
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),

    HealthModule,

    // Feature modules
    AuthModule,
    UserModule,
    PlanEventModule,
    PackageModule,
    OrganizerModule,
    BookingModule,
    ContentModule,
    NotificationModule,
    QuoteModule,
    HomeModule,
    PlanModule,
    UploadModule,
    SubvendorModule,
    InvitationModule,
    IdeaModule,
    ContactModule,
    AdminModule,
    // ChatModule — still a stub
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
    // Order matters: rate-limit, then authenticate. JwtAuthGuard honours @Public().
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule implements NestModule {
  // Assign a correlation ID to every request before guards/interceptors run.
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
