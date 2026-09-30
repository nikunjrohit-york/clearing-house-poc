import {
  IsString,
  IsOptional,
  IsEnum,
  IsNumber,
  ValidateNested,
  IsArray,
  IsDateString,
  IsNotEmpty,
  Min,
  ArrayMinSize,
  Validate,
  ValidateIf,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { Type } from 'class-transformer';

export function isValidNpi(value: unknown): boolean {
  if (typeof value !== 'string' || !/^\d{10}$/.test(value)) {
    return false;
  }
  const payload = `80840${value}`;
  let sum = 0;
  let alternate = false;
  for (let index = payload.length - 1; index >= 0; index -= 1) {
    let digit = Number(payload[index]);
    if (alternate) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9;
      }
    }
    sum += digit;
    alternate = !alternate;
  }
  return sum % 10 === 0;
}

export function isValidTaxId(value: unknown): boolean {
  if (typeof value !== 'string') {
    return false;
  }
  return /^\d{9}$/.test(value.replace(/-/g, ''));
}

export function lineChargesCents(lines: ClaimServiceLine[] | undefined): number {
  if (!lines?.length) {
    return 0;
  }
  return lines.reduce((sum, line) => {
    const quantity = Number(line?.quantity);
    const unitPrice = Number(line?.unitPrice);
    if (!Number.isFinite(quantity) || !Number.isFinite(unitPrice)) {
      return sum;
    }
    return sum + Math.round(quantity * unitPrice * 100);
  }, 0);
}

@ValidatorConstraint({ name: 'npi', async: false })
export class NpiConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return isValidNpi(value);
  }

  defaultMessage(): string {
    return 'NPI must be a valid 10-digit NPI';
  }
}

@ValidatorConstraint({ name: 'taxId', async: false })
export class TaxIdConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return isValidTaxId(value);
  }

  defaultMessage(): string {
    return 'Tax ID must be a 9-digit EIN';
  }
}

@ValidatorConstraint({ name: 'billingTaxId', async: false })
export class BillingTaxIdConstraint implements ValidatorConstraintInterface {
  validate(billing: ClaimProvider): boolean {
    return isValidTaxId(billing?.taxId);
  }

  defaultMessage(): string {
    return 'Billing provider Tax ID must be a 9-digit EIN';
  }
}

@ValidatorConstraint({ name: 'claimChargeBalance', async: false })
export class ClaimChargeBalanceConstraint implements ValidatorConstraintInterface {
  validate(totalCharge: number, args: ValidationArguments): boolean {
    const claim = args.object as ClaimInputDto;
    if (!claim?.serviceLines?.length || typeof totalCharge !== 'number' || Number.isNaN(totalCharge)) {
      return false;
    }
    return lineChargesCents(claim.serviceLines) === Math.round(totalCharge * 100);
  }

  defaultMessage(): string {
    return 'Service line charges (quantity × unit price) must equal totalCharge';
  }
}

export enum ClaimType {
  PROFESSIONAL = 'professional',
  INSTITUTIONAL = 'institutional',
  DENTAL = 'dental',
}

export enum ClaimFrequencyCode {
  ORIGINAL = '1',
  INTERIM = '2',
  FINAL = '3',
  VOID = '4',
  REPLACEMENT = '5',
  CORRECTED = '6',
  REPLACEMENT_OF_PRIOR = '7',
  VOID_OF_PRIOR = '8',
}

export enum PlaceOfService {
  OFFICE = '11',
  HOME = '12',
  ASSISTED_LIVING = '13',
  GROUP_HOME = '14',
  MOBILE_UNIT = '15',
  URGENT_CARE = '20',
  INPATIENT_HOSPITAL = '21',
  OUTPATIENT_HOSPITAL = '22',
  EMERGENCY_ROOM = '23',
  AMBULATORY_SURGICAL_CENTER = '24',
  BIRTHING_CENTER = '25',
  MILITARY_TREATMENT = '26',
  SKILLED_NURSING = '31',
  NURSING_FACILITY = '32',
  CUSTODIAL_CARE = '33',
  HOSPICE = '34',
  AMBULANCE_LAND = '41',
  AMBULANCE_AIR = '42',
  INDEPENDENT_LAB = '81',
}

export class ClaimProvider {
  @IsString()
  @IsNotEmpty()
  @Validate(NpiConstraint)
  npi: string;

  @ValidateIf((provider: ClaimProvider) => provider.taxId !== undefined && provider.taxId !== null && provider.taxId !== '')
  @Validate(TaxIdConstraint)
  taxId?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  specialty?: string;

  @IsOptional()
  @IsString()
  address1?: string;

  @IsOptional()
  @IsString()
  address2?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  state?: string;

  @IsOptional()
  @IsString()
  zip?: string;
}

export class ClaimSubscriber {
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

  @IsOptional()
  @IsString()
  address1?: string;

  @IsOptional()
  @IsString()
  address2?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  state?: string;

  @IsOptional()
  @IsString()
  zip?: string;

  @IsOptional()
  @IsString()
  relationship?: string;
}

export class ClaimDependent {
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

  @IsOptional()
  @IsString()
  address1?: string;

  @IsOptional()
  @IsString()
  address2?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  state?: string;

  @IsOptional()
  @IsString()
  zip?: string;
}

export class ClaimDiagnosis {
  @IsString()
  code: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsNumber()
  pointer?: number;
}

export class ClaimServiceLine {
  @IsNumber()
  lineNumber: number;

  @IsDateString()
  serviceDate: string;

  @IsString()
  procedureCode: string;

  @IsOptional()
  @IsString()
  modifier1?: string;

  @IsOptional()
  @IsString()
  modifier2?: string;

  @IsOptional()
  @IsString()
  modifier3?: string;

  @IsOptional()
  @IsString()
  modifier4?: string;

  @IsNumber()
  @Min(1)
  quantity: number;

  @IsNumber()
  @Min(0)
  unitPrice: number;

  @IsOptional()
  @IsString()
  diagnosisPointer?: string;

  @IsOptional()
  @IsEnum(PlaceOfService)
  placeOfService?: PlaceOfService;

  @ValidateIf((line: ClaimServiceLine) => line.npi !== undefined && line.npi !== null && line.npi !== '')
  @Validate(NpiConstraint)
  npi?: string;
}

export class ClaimInputDto {
  @IsEnum(ClaimType)
  claimType: ClaimType;

  @IsString()
  @IsNotEmpty()
  tradingPartnerId: string;

  @IsString()
  @IsNotEmpty()
  claimControlNumber: string;

  @IsEnum(ClaimFrequencyCode)
  frequencyCode: ClaimFrequencyCode;

  @Validate(BillingTaxIdConstraint)
  @ValidateNested()
  @Type(() => ClaimProvider)
  billingProvider: ClaimProvider;

  @ValidateNested()
  @Type(() => ClaimProvider)
  @IsOptional()
  renderingProvider?: ClaimProvider;

  @ValidateNested()
  @Type(() => ClaimSubscriber)
  subscriber: ClaimSubscriber;

  @ValidateNested()
  @Type(() => ClaimDependent)
  @IsOptional()
  dependent?: ClaimDependent;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ClaimDiagnosis)
  diagnoses: ClaimDiagnosis[];

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ClaimServiceLine)
  serviceLines: ClaimServiceLine[];

  @IsNumber()
  @Min(0)
  @Validate(ClaimChargeBalanceConstraint)
  totalCharge: number;

  @IsOptional()
  @IsString()
  patientAccountNumber?: string;

  @IsOptional()
  @IsDateString()
  admissionDate?: string;

  @IsOptional()
  @IsDateString()
  dischargeDate?: string;

  @IsOptional()
  @IsString()
  admissionType?: string;

  @IsOptional()
  @IsString()
  admissionSource?: string;

  @IsOptional()
  @IsString()
  dischargeStatus?: string;
}