import { IsEnum } from 'class-validator';
import { UploadPurpose } from '../upload.constants';

/** Multipart body accompanying an uploaded file. */
export class UploadFileDto {
  @IsEnum(UploadPurpose, {
    message: 'purpose must be a valid upload purpose',
  })
  purpose: UploadPurpose;
}
