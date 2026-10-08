import { Transform } from 'class-transformer';
import { IsDateString, IsIn, IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function trimRequired({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

function trimOptional({ value }: { value: unknown }): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function trimGender({ value }: { value: unknown }): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim().toUpperCase();
  return trimmed.length > 0 ? trimmed : undefined;
}

export class CoverageInquiryDto {
  @Transform(trimRequired)
  @IsString()
  @IsNotEmpty()
  payerId: string;

  @Transform(trimRequired)
  @IsString()
  @IsNotEmpty()
  memberId: string;

  @Transform(trimRequired)
  @IsString()
  @IsNotEmpty()
  patientFirstName: string;

  @Transform(trimRequired)
  @IsString()
  @IsNotEmpty()
  patientLastName: string;

  @Transform(trimRequired)
  @IsDateString()
  @Matches(ISO_DATE, { message: 'patientBirthDate must be YYYY-MM-DD' })
  patientBirthDate: string;

  @IsOptional()
  @Transform(trimGender)
  @IsIn(['M', 'F'])
  patientGender?: 'M' | 'F';

  @Transform(trimRequired)
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{10}$/, { message: 'Provider NPI must be exactly 10 digits' })
  providerNpi: string;

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @IsNotEmpty()
  serviceTypeCode?: string;

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @IsNotEmpty()
  procedureCode?: string;

  @IsOptional()
  @Transform(trimOptional)
  @IsDateString()
  @Matches(ISO_DATE, { message: 'serviceDate must be YYYY-MM-DD' })
  serviceDate?: string;
}
