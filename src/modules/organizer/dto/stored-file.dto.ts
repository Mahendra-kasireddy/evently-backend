import { IsInt, IsOptional, IsString, Min } from 'class-validator';

/** Metadata for an uploaded asset, as returned by POST /upload. */
export class StoredFileDto {
  @IsString()
  url: string;

  @IsString()
  key: string;

  @IsOptional()
  @IsString()
  originalName?: string;

  @IsOptional()
  @IsString()
  mimeType?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  size?: number;

  @IsOptional()
  @IsString()
  uploadedAt?: string;
}
