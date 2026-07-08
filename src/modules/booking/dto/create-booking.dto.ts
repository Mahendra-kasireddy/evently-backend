import { IsMongoId } from 'class-validator';

/** Create a booking from an accepted quotation. */
export class CreateBookingDto {
  @IsMongoId()
  quotationId: string;
}
