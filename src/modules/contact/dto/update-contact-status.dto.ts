import { IsEnum } from 'class-validator';
import { ContactStatus } from '../schemas/contact-request.schema';

/** Move a request through the queue without replying to it. */
export class UpdateContactStatusDto {
  @IsEnum(ContactStatus, { message: 'Unknown contact status' })
  status: ContactStatus;
}
