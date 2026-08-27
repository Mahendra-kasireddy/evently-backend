import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { BookingStatus, PaymentStatus } from '../schemas/booking.schema';

/** Admin booking list query: ?status=&paymentStatus=&search=&page=&limit= */
export class ListBookingsDto extends PaginationDto {
  @IsOptional()
  @IsEnum(BookingStatus, { message: 'Unknown booking status' })
  status?: BookingStatus;

  @IsOptional()
  @IsEnum(PaymentStatus, { message: 'Unknown payment status' })
  paymentStatus?: PaymentStatus;

  /** Matches the booking reference, title or venue. */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  search?: string;
}
