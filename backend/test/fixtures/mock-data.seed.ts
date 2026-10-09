import { ClaimStatusQueryDto } from '../../src/availity-rest/dto/claim-status-query.dto';
import { CoverageInquiryDto } from '../../src/availity-rest/dto/coverage-inquiry.dto';
import { ClaimFrequencyCode, ClaimInputDto, ClaimType, PlaceOfService } from '../../src/edi/dto/claim-input.dto';

export const SAMPLE_BATCH_ID = 'BAT-992014';
export const SAMPLE_FILE_CONTROL_NUMBER = 'FCN-00049281';
export const SAMPLE_CLAIM_CONTROL_NUMBER = 'PCN-2023-001';

export const eligibilityInquiry: CoverageInquiryDto = {
  payerId: '00001',
  memberId: 'MEM8941029',
  patientFirstName: 'JOHN',
  patientLastName: 'DOE',
  patientBirthDate: '1985-04-12',
  patientGender: 'M',
  serviceTypeCode: '30',
  providerNpi: '1234567893',
  serviceDate: '2026-09-10',
};

export interface MockCoverageBenefit {
  type: string;
  name: string;
  amount?: string;
  percent?: string;
  coverage?: string;
}

export interface MockCoveragePlan {
  status: string;
  statusCode: string;
  planName: string;
  copay?: { amount: number };
  deductible?: { individualRemaining: number; individualTotal: number };
  coinsurance?: { percent: number };
  benefits: MockCoverageBenefit[];
}

export interface MockCoverageResponse {
  id: string;
  statusCode: 3;
  status: 'Complete';
  mock: true;
  payerId: string;
  payerName: string;
  memberId: string;
  patientFirstName: string;
  patientLastName: string;
  patientBirthDate: string;
  patientGender?: 'M' | 'F';
  providerNpi: string;
  serviceType: string;
  procedureCode?: string;
  serviceDate?: string;
  plans: MockCoveragePlan[];
}

const INACTIVE_MEMBER_IDS = new Set(['MEM9999999']);

export function mockCoverageResponse(query: CoverageInquiryDto): MockCoverageResponse {
  const serviceType = query.serviceTypeCode?.trim() || '30';
  const procedureCode = query.procedureCode?.trim();
  const inactive = INACTIVE_MEMBER_IDS.has(query.memberId.trim().toUpperCase());
  const shared = {
    statusCode: 3 as const,
    status: 'Complete' as const,
    mock: true as const,
    payerId: query.payerId,
    payerName: 'Availity Sandbox Payer',
    memberId: query.memberId,
    patientFirstName: query.patientFirstName,
    patientLastName: query.patientLastName,
    patientBirthDate: query.patientBirthDate,
    ...(query.patientGender ? { patientGender: query.patientGender } : {}),
    providerNpi: query.providerNpi,
    serviceType,
    ...(procedureCode ? { procedureCode } : {}),
    ...(query.serviceDate ? { serviceDate: query.serviceDate } : {}),
  };

  if (inactive) {
    return {
      ...shared,
      id: 'MOCK-COV-INACTIVE',
      plans: [
        {
          status: 'Inactive',
          statusCode: '6',
          planName: 'Policy not in force',
          benefits: [{ type: 'Coverage', name: 'Eligibility', coverage: 'Inactive' }],
        },
      ],
    };
  }

  const benefits: MockCoverageBenefit[] = [
    { type: 'Copay', name: 'Office visit copay', amount: '30.00' },
    { type: 'Deductible', name: 'Individual deductible remaining', amount: '450.00' },
    { type: 'Coinsurance', name: 'Coinsurance', percent: '20' },
  ];
  if (procedureCode) {
    benefits.push({
      type: 'Procedure',
      name: procedureCode,
      coverage: 'Covered',
      amount: procedureCode === '99213' ? '150.00' : '0.00',
    });
  }

  return {
    ...shared,
    id: procedureCode ? `MOCK-COV-${procedureCode}` : 'MOCK-COV-ACTIVE',
    plans: [
      {
        status: 'Active',
        statusCode: '1',
        planName: procedureCode ? `Professional visit ${procedureCode}` : 'Aetna Choice POS II',
        copay: { amount: 30 },
        deductible: { individualRemaining: 450, individualTotal: 1500 },
        coinsurance: { percent: 20 },
        benefits,
      },
    ],
  };
}

export const claimStatusQuery: ClaimStatusQueryDto = {
  payerId: '00001',
  providerNpi: '1234567893',
  memberId: 'MEM8941029',
  patientFirstName: 'JOHN',
  patientLastName: 'DOE',
  patientBirthDate: '1985-04-12',
  patientControlNumber: SAMPLE_CLAIM_CONTROL_NUMBER,
  serviceDate: '2026-09-10',
};

export function professionalClaim(claimControlNumber = SAMPLE_CLAIM_CONTROL_NUMBER): ClaimInputDto {
  return {
    claimType: ClaimType.PROFESSIONAL,
    tradingPartnerId: '00001',
    claimControlNumber,
    frequencyCode: ClaimFrequencyCode.ORIGINAL,
    placeOfService: PlaceOfService.OFFICE,
    billingProvider: {
      npi: '1234567893',
      taxId: '12-3456789',
      name: 'RIVERSIDE FAMILY CLINIC',
      organizationName: 'RIVERSIDE FAMILY CLINIC',
      address: {
        address1: '1200 RIVERPLACE BLVD',
        city: 'JACKSONVILLE',
        state: 'FL',
        zip: '32207',
      },
    },
    renderingProvider: {
      npi: '1234567893',
      name: 'CHEN',
    },
    subscriber: {
      memberId: 'MEM8941029',
      firstName: 'JOHN',
      lastName: 'DOE',
      birthDate: '1985-04-12',
      gender: 'M',
      address: {
        address1: '88 OAK STREET',
        city: 'JACKSONVILLE',
        state: 'FL',
        zip: '32202',
      },
    },
    diagnoses: [
      { code: 'J06.9', description: 'Acute upper respiratory infection' },
      { code: 'R05.9', description: 'Cough' },
    ],
    serviceLines: [
      {
        lineNumber: 1,
        serviceDate: '2026-09-10',
        procedureCode: '99213',
        modifier1: '25',
        quantity: 1,
        unitPrice: 150,
        diagnosisPointer: '1',
        placeOfService: PlaceOfService.OFFICE,
      },
      {
        lineNumber: 2,
        serviceDate: '2026-09-10',
        procedureCode: '87880',
        quantity: 1,
        unitPrice: 35,
        diagnosisPointer: '1',
        placeOfService: PlaceOfService.OFFICE,
      },
    ],
    totalCharge: 185,
    patientAccountNumber: claimControlNumber,
  };
}

export const sampleIbr = [
  `1|2026-09-28 14:32:00|${SAMPLE_BATCH_ID}|${SAMPLE_FILE_CONTROL_NUMBER}|2|1|1`,
  '2|00001|Aetna Commercial Payer',
  `3|DOE, JOHN|20260920|${SAMPLE_CLAIM_CONTROL_NUMBER}|150.00|1234567893|A`,
  '3|SMITH, JANE|20260922|PCN-2023-002|35.00|1234567893|R',
  '3e|HIPAA|E102|Invalid or missing Subscriber ID qualifier|NM1|2010BA|09',
  '3w|Availity|W201|Provider taxonomy code recommended|PRV|2000A|03',
].join('\n');

export const sampleEbr = [
  '1|2026-09-28 15:04:11|BAT-992088|FCN-00049310|1|1|0',
  '2|00001|Aetna Commercial Payer',
  `3|DOE, JOHN|20260920|${SAMPLE_CLAIM_CONTROL_NUMBER}|185.00|1234567893|A`,
].join('\n');

export const sample999 = [
  'ISA*00*          *00*          *ZZ*030240928      *01*AV09311993     *260928*1435*^*00501*000000099*0*P*:~',
  'GS*FA*030240928*AV09311993*20260928*1435*1*X*005010X231A1~',
  'ST*999*0001*005010X231A1~',
  'AK1*HC*100001*005010X222A1~',
  'AK2*837*0001*005010X222A1~',
  'IK3*CLM*25*2300*8~',
  'IK4*1*1028*7*ABC~',
  'IK5*R~',
  'AK9*P*1*1*0*5~',
  'SE*8*0001~',
].join('\n');
