import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ContactController } from './contact.controller';
import { AdminContactController } from './admin-contact.controller';
import { ContactService } from './contact.service';
import { SupportMailProvider } from './providers/support-mail.provider';
import { ContactRequest, ContactRequestSchema } from './schemas/contact-request.schema';
import { NotificationModule } from '../notification/notification.module';
import { UserModule } from '../user/user.module';

/**
 * Contact Us — the customer form and the admin queue behind it. Reuses the
 * existing notification service for in-app delivery and the existing user
 * service for prefill; it creates no second auth, user or messaging system.
 */
@Module({
  imports: [
    MongooseModule.forFeature([{ name: ContactRequest.name, schema: ContactRequestSchema }]),
    NotificationModule,
    UserModule,
  ],
  controllers: [ContactController, AdminContactController],
  providers: [ContactService, SupportMailProvider],
  exports: [ContactService],
})
export class ContactModule {}
