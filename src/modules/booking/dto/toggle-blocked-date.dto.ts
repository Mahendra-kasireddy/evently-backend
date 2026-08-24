import { IsBoolean, IsDateString } from 'class-validator';

export class ToggleBlockedDateDto {
  @IsDateString()
  date: string;

  @IsBoolean()
  blocked: boolean;
}
