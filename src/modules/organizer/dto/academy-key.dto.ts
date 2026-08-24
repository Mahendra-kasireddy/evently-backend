import { IsString, MinLength } from 'class-validator';

export class AcademyKeyDto {
  @IsString()
  @MinLength(1)
  key: string;
}
