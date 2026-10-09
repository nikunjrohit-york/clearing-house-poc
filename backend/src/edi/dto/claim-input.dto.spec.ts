import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  ClaimFrequencyCode,
  ClaimInputDto,
  ClaimType,
  PlaceOfService,
  isValidNpi,
  isValidTaxId,
  lineChargesCents,
} from './claim-input.dto';

const billingAddress = { address1: '100 Main St', city: 'Concord', state: 'NH', zip: '03301' };
const subscriberAddress = { address1: '200 Elm St', city: 'Concord', state: 'NH', zip: '03301' };

function claim(overrides: Record<string, unknown> = {}): ClaimInputDto {
  return plainToInstance(ClaimInputDto, {
    claimType: ClaimType.PROFESSIONAL,
    tradingPartnerId: '00001',
    claimControlNumber: 'CLM123456',
    frequencyCode: ClaimFrequencyCode.ORIGINAL,
    placeOfService: PlaceOfService.OFFICE,
    billingProvider: {
      name: 'The Delphi Group LLC',
      organizationName: 'The Delphi Group LLC',
      npi: '1194476978',
      taxId: '27-2499372',
      address: billingAddress,
    },
    subscriber: {
      firstName: 'John',
      lastName: 'Doe',
      memberId: 'MEM123456',
      birthDate: '1980-01-01',
      gender: 'M',
      address: subscriberAddress,
    },
    diagnoses: [{ code: 'I10' }],
    serviceLines: [
      {
        lineNumber: 1,
        procedureCode: '99213',
        quantity: 1,
        unitPrice: 100,
        serviceDate: '2026-03-01',
        placeOfService: PlaceOfService.OFFICE,
        diagnosisPointer: '1',
      },
    ],
    totalCharge: 100,
    ...overrides,
  });
}

function walk(error: { constraints?: Record<string, string>; children?: Array<{ constraints?: Record<string, string>; children?: unknown[] }> }): string[] {
  const own = error.constraints ? Object.values(error.constraints) : [];
  const children = (error.children ?? []).flatMap((child) => walk(child as typeof error));
  return [...own, ...children];
}

function messages(dto: ClaimInputDto): string[] {
  return validateSync(dto, { whitelist: true }).flatMap((error) => walk(error));
}

describe('ClaimInputDto', () => {
  it('accepts the QA office-visit claim', () => {
    expect(messages(claim())).toEqual([]);
  });

  it('requires a 10-digit NPI that passes the Luhn check', () => {
    expect(isValidNpi('1194476978')).toBe(true);
    expect(isValidNpi('1234567890')).toBe(false);
    expect(
      messages(
        claim({
          billingProvider: {
            organizationName: 'The Delphi Group LLC',
            npi: '1234567890',
            taxId: '27-2499372',
            address: billingAddress,
          },
        }),
      ).join('\n'),
    ).toMatch(/NPI/);
  });

  it('requires a dashed EIN and balanced line charges', () => {
    expect(isValidTaxId('27-2499372')).toBe(true);
    expect(isValidTaxId('123456789')).toBe(false);
    expect(
      messages(
        claim({
          billingProvider: {
            organizationName: 'The Delphi Group LLC',
            npi: '1194476978',
            taxId: '123456789',
            address: billingAddress,
          },
        }),
      ).join('\n'),
    ).toMatch(/NN-NNNNNNN/);
    expect(lineChargesCents(claim().serviceLines)).toBe(10000);
    expect(messages(claim({ totalCharge: 10 })).join('\n')).toMatch(/totalCharge/);
  });

  it('fills billing name from organizationName and rejects an E-code primary diagnosis', () => {
    const named = claim({
      billingProvider: {
        organizationName: 'The Delphi Group LLC',
        npi: '1194476978',
        taxId: '27-2499372',
        address: billingAddress,
      },
    });
    expect(messages(named)).toEqual([]);
    expect(named.billingProvider.name).toBe('The Delphi Group LLC');
    expect(named.billingProvider.organizationName).toBe('The Delphi Group LLC');
    expect(messages(claim({ diagnoses: [{ code: 'E11.9' }] })).join('\n')).toMatch(/cannot start with E/);
  });

  it('requires sequential 1-based line numbers and a string diagnosis pointer', () => {
    expect(
      messages(
        claim({
          serviceLines: [
            {
              lineNumber: 2,
              procedureCode: '99213',
              quantity: 1,
              unitPrice: 100,
              serviceDate: '2026-03-01',
              placeOfService: PlaceOfService.OFFICE,
              diagnosisPointer: '1',
            },
          ],
        }),
      ).join('\n'),
    ).toMatch(/lineNumber/);
    expect(
      messages(
        claim({
          serviceLines: [
            {
              lineNumber: 1,
              procedureCode: '99213',
              quantity: 1,
              unitPrice: 100,
              serviceDate: '2026-03-01',
              placeOfService: PlaceOfService.OFFICE,
              diagnosisPointer: 1,
            },
          ],
        }),
      ).join('\n'),
    ).toMatch(/diagnosisPointer/);
  });
});
