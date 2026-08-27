import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { ContactStatus, ContactSubject } from '../schemas/contact-request.schema';

/** Admin queue query: ?status=&subject=&search=&page=&limit= */
export class ListContactRequestsDto extends PaginationDto {
  @IsOptional()
  @IsEnum(ContactStatus, { message: 'Unknown contact status' })
  status?: ContactStatus;

  @IsOptional()
  @IsEnum(ContactSubject, { message: 'Unknown subject' })
  subject?: ContactSubject;

  /** Matches name, email or phone. */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  search?: string;
}
