import { PartialType } from '@nestjs/mapped-types';
import { RespondQuotationDto } from './respond-quotation.dto';

/** Organizer revises an existing quotation (all fields optional). */
export class UpdateQuotationDto extends PartialType(RespondQuotationDto) {}
