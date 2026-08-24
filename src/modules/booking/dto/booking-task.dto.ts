import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDate,
  IsEnum,
  IsMongoId,
  IsOptional,
  IsString,
  Min,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { BookingTaskStatus } from '../schemas/booking.schema';
import { StoredFileDto } from '../../organizer/dto/stored-file.dto';

export class CreateBookingTaskDto {
  @IsString()
  @MaxLength(160)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  assigneeName?: string;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  dueDate?: Date;

  // Assign directly to one of the organizer's linked sub-vendors.
  @IsOptional()
  @IsMongoId()
  subVendorId?: string;

  @IsOptional()
  @Type(() => Number)
  @Min(0)
  amount?: number;
}

export class UpdateBookingTaskDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  title?: string;

  @IsOptional()
  @IsEnum(BookingTaskStatus)
  status?: BookingTaskStatus;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  assigneeName?: string;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  dueDate?: Date;

  @IsOptional()
  @ValidateNested()
  @Type(() => StoredFileDto)
  photoProof?: StoredFileDto;

  // Organizer re-assigning/unassigning — set null to clear the assignment.
  @IsOptional()
  @IsMongoId()
  subVendorId?: string | null;

  @IsOptional()
  @Type(() => Number)
  @Min(0)
  amount?: number;
}

export class RespondTaskAssignmentDto {
  @IsBoolean()
  accept: boolean;
}
