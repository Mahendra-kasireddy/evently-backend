import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { IdeaType } from '../schemas/booking-idea.schema';

class IdeaImageDto {
  @IsString()
  @MaxLength(600)
  url: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  key?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  originalName?: string;
}

/** A customer post on the board. */
export class CreateIdeaDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  text: string;

  @IsOptional()
  @IsEnum(IdeaType)
  type?: IdeaType;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => IdeaImageDto)
  images?: IdeaImageDto[];

  /** A surprise: planned with the organizer, kept out of anything shared. */
  @IsOptional()
  @IsBoolean()
  confidential?: boolean;
}
