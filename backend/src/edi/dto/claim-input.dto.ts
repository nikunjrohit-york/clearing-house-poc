import {
  IsString,
  IsOptional,
  IsEnum,
  IsNumber,
  ValidateNested,
  IsArray,
  IsDateString,
  IsNotEmpty,
  IsIn,
  Min,
  ArrayMinSize,
  IsBoolean,
  Validate,
  ValidateIf,
  Matches,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { Expose, Transform, Type } from 'class-transformer';

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
  return typeof value === 'string' && /^\d{2}-\d{7}$/.test(value);
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
    return 'Tax ID must match NN-NNNNNNN, for example 12-3456789';
  }
}

function filled(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

@ValidatorConstraint({ name: 'primaryDiagnosis', async: false })
export class PrimaryDiagnosisConstraint implements ValidatorConstraintInterface {
  validate(diagnoses: ClaimDiagnosis[] | undefined): boolean {
    const code = diagnoses?.[0]?.code?.trim() ?? '';
    if (!code) {
      return true;
    }
    return /^(?![Ee])/.test(code);
  }

  defaultMessage(): string {
    return 'Primary diagnosis cannot start with E';
  }
}

@ValidatorConstraint({ name: 'sequentialLineNumbers', async: false })
export class SequentialLineNumbersConstraint implements ValidatorConstraintInterface {
  validate(lines: ClaimServiceLine[] | undefined): boolean {
    if (!lines?.length) {
      return false;
    }
    return lines.every((line, index) => line?.lineNumber === index + 1);
  }

  defaultMessage(): string {
    return 'lineNumber must be the 1-based position of each service line';
  }
}

@ValidatorConstraint({ name: 'billingTaxId', async: false })
export class BillingTaxIdConstraint implements ValidatorConstraintInterface {
  validate(billing: BillingProvider): boolean {
    return isValidTaxId(billing?.taxId);
  }

  defaultMessage(): string {
    return 'Billing provider Tax ID must match NN-NNNNNNN, for example 12-3456789';
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

export class ClaimAddress {
  @IsString()
  @IsNotEmpty()
  address1: string;

  @IsOptional()
  @IsString()
  address2?: string;

  @IsString()
  @IsNotEmpty()
  city: string;

  @IsString()
  @IsNotEmpty()
  state: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{5}(\d{4})?$/, { message: 'ZIP codes cannot contain a dash' })
  zip: string;
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
  organizationName?: string;

  @IsOptional()
  @IsString()
  specialty?: string;
}

export class BillingProvider {
  @Expose()
  @Transform(({ obj }) => {
    const record = obj as { name?: unknown; organizationName?: unknown };
    return filled(record.name) || filled(record.organizationName);
  })
  @IsString()
  @IsNotEmpty()
  name: string;

  @Expose()
  @Transform(({ obj }) => {
    const record = obj as { name?: unknown; organizationName?: unknown };
    return filled(record.organizationName) || filled(record.name);
  })
  @IsString()
  @IsNotEmpty()
  organizationName: string;

  @IsString()
  @IsNotEmpty()
  @Validate(NpiConstraint)
  npi: string;

  @IsString()
  @Validate(TaxIdConstraint)
  taxId: string;

  @ValidateNested()
  @Type(() => ClaimAddress)
  address: ClaimAddress;

  @IsOptional()
  @IsString()
  specialty?: string;
}

export class ClaimSubscriber {
  @IsString()
  @IsNotEmpty()
  memberId: string;

  @IsString()
  @IsNotEmpty()
  firstName: string;

  @IsString()
  @IsNotEmpty()
  lastName: string;

  @IsDateString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'birthDate must be YYYY-MM-DD' })
  birthDate: string;

  @IsIn(['M', 'F'])
  gender: 'M' | 'F';

  @ValidateNested()
  @Type(() => ClaimAddress)
  address: ClaimAddress;

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
  @Min(1)
  lineNumber: number;

  @IsDateString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'serviceDate must be YYYY-MM-DD' })
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

  @IsString()
  @Matches(/^[1-9]\d*$/, { message: 'diagnosisPointer must be a 1-based index string such as "1"' })
  diagnosisPointer: string;

  @Expose()
  @Transform(({ value }) => (value === undefined || value === null || value === '' ? PlaceOfService.OFFICE : value))
  @IsEnum(PlaceOfService)
  placeOfService: PlaceOfService;

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

  @Expose()
  @Transform(({ value }) => (value === undefined || value === null || value === '' ? ClaimFrequencyCode.ORIGINAL : value))
  @IsEnum(ClaimFrequencyCode)
  frequencyCode: ClaimFrequencyCode;

  @Expose()
  @Transform(({ value }) => (value === undefined || value === null || value === '' ? PlaceOfService.OFFICE : value))
  @IsEnum(PlaceOfService)
  placeOfService: PlaceOfService;

  @ValidateNested()
  @Type(() => BillingProvider)
  billingProvider: BillingProvider;

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
  @Validate(PrimaryDiagnosisConstraint)
  diagnoses: ClaimDiagnosis[];

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ClaimServiceLine)
  @Validate(SequentialLineNumbersConstraint)
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

  // UNCONFIRMED: which procedure codes require CR5/CR6. Callers set these flags; incomplete segments are rejected.
  @IsOptional()
  @IsBoolean()
  oxygenTherapy?: boolean;

  @IsOptional()
  @IsBoolean()
  homeHealth?: boolean;
}