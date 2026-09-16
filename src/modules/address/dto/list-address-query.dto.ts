import { Type } from 'class-transformer';
import { IsLatitude, IsLongitude, IsOptional } from 'class-validator';

/**
 * Where the customer is asking from, so the list can be sorted by distance.
 *
 * Both or neither. A latitude without a longitude describes no point, and
 * quietly treating it as one would put every distance in the Gulf of Guinea —
 * so the controller only measures when it has both, and otherwise returns the
 * list unmeasured rather than measured wrongly.
 *
 * `@Type(() => Number)` is required because query strings arrive as text and
 * the global ValidationPipe's implicit conversion is what turns "17.38" into a
 * number the latitude check can judge.
 */
export class ListAddressQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsLatitude()
  lat?: number;

  @IsOptional()
  @Type(() => Number)
  @IsLongitude()
  lng?: number;
}
