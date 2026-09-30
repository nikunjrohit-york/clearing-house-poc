import { IsString, IsOptional, IsEnum, IsNumber, ValidateNested, IsArray, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';

export enum ServiceType {
  MEDICAL_CARE = '1',
  SURGICAL = '2',
  CONSULTATION = '3',
  DIAGNOSTIC_XRAY = '4',
  DIAGNOSTIC_LAB = '5',
  RADIATION_THERAPY = '6',
  ANESTHESIA = '7',
  SURGICAL_ASSISTANCE = '8',
  OTHER_MEDICAL = '9',
}

export enum EligibilityBenefitType {
  COINSURANCE = 'A',
  COPAY = 'B',
  DEDUCTIBLE = 'C',
  COINSURANCE_MAXIMUM = 'D',
  COPAY_MAXIMUM = 'E',
  DEDUCTIBLE_MAXIMUM = 'F',
  OUT_OF_POCKET = 'G',
  LIFETIME_MAXIMUM = 'H',
  NON_COVERED = 'I',
  EXCLUDED = 'J',
}

export class ProviderInfo {
  @IsString()
  npi: string;

  @IsOptional()
  @IsString()
  taxId?: string;

  @IsOptional()
  @IsString()
  name?: string;
}

export class SubscriberInfo {
  @IsString()
  memberId: string;

  @IsOptional()
  @IsString()
  firstName?: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @IsOptional()
  @IsString()
  gender?: string;
}

export class DependentInfo {
  @IsString()
  memberId: string;

  @IsString()
  firstName: string;

  @IsString()
  lastName: string;

  @IsDateString()
  dateOfBirth: string;

  @IsString()
  gender: string;

  @IsOptional()
  @IsString()
  relationship?: string;
}

export class EligibilityQueryDto {
  @IsString()
  tradingPartnerId: string;

  @ValidateNested()
  @Type(() => ProviderInfo)
  provider: ProviderInfo;

  @ValidateNested()
  @Type(() => SubscriberInfo)
  subscriber: SubscriberInfo;

  @ValidateNested()
  @Type(() => DependentInfo)
  @IsOptional()
  dependent?: DependentInfo;

  @IsOptional()
  @IsEnum(ServiceType)
  serviceType?: ServiceType;

  @IsOptional()
  @IsString()
  serviceTypeCode?: string;

  @IsOptional()
  @IsDateString()
  serviceDate?: string;

  @IsOptional()
  @IsString()
  referenceId?: string;
}