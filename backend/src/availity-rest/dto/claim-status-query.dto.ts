import { IsDateString, IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';

export class ClaimStatusQueryDto {
  @IsString()
  @IsNotEmpty()
  payerId: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{10}$/, { message: 'Provider NPI must be exactly 10 digits' })
  providerNpi: string;

  @IsString()
  @IsNotEmpty()
  memberId: string;

  @IsString()
  @IsNotEmpty()
  patientLastName: string;

  @IsString()
  @IsNotEmpty()
  patientFirstName: string;

  @IsOptional()
  @IsDateString()
  patientBirthDate?: string;

  @IsOptional()
  @IsString()
  patientControlNumber?: string;

  @IsOptional()
  @IsDateString()
  serviceDate?: string;
}
