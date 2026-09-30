import { IsDateString, IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';

export class CoverageInquiryDto {
  @IsString()
  @IsNotEmpty()
  payerId: string;

  @IsString()
  @IsNotEmpty()
  memberId: string;

  @IsOptional()
  @IsString()
  serviceTypeCode?: string;

  @IsOptional()
  @IsString()
  patientFirstName?: string;

  @IsOptional()
  @IsString()
  patientLastName?: string;

  @IsOptional()
  @IsDateString()
  patientBirthDate?: string;

  @IsOptional()
  @IsString()
  patientGender?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{10}$/, { message: 'Provider NPI must be exactly 10 digits' })
  providerNpi?: string;

  @IsOptional()
  @IsDateString()
  asOfDate?: string;
}
