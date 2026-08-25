import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { OnboardingStatus } from '../schemas/organizer-profile.schema';

/** Admin organizer list query: ?status=&search=&page=&limit= */
export class ListOrganizersDto extends PaginationDto {
  /** One of the real lifecycle states. Omitted = every state. */
  @IsOptional()
  @IsEnum(OnboardingStatus, { message: 'Unknown organizer status' })
  status?: OnboardingStatus;

  /** Matches business name, contact name or mobile number. */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  search?: string;
}
