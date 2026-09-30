import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClaimFrequencyCode, ClaimInputDto, ClaimType, PlaceOfService } from './dto/claim-input.dto';
import { X12BuilderService } from './x12-builder.service';

function service(): X12BuilderService {
  const values: Record<string, string> = {
    AVAILITY_SUBMITTER_ID: 'AV09311993',
    AVAILITY_RECEIVER_ID: '030240928',
    AVAILITY_USAGE_INDICATOR: 'T',
  };
  return new X12BuilderService({
    get: (key: string) => values[key],
  } as ConfigService);
}

function claim(overrides: Partial<ClaimInputDto> = {}): ClaimInputDto {
  return {
    claimType: ClaimType.PROFESSIONAL,
    tradingPartnerId: '00001',
    claimControlNumber: 'PCN001',
    frequencyCode: ClaimFrequencyCode.ORIGINAL,
    billingProvider: {
      npi: '1234567893',
      taxId: '12-3456789',
      name: 'BILLING CLINIC',
      address1: '123 MAIN ST',
      city: 'JACKSONVILLE',
      state: 'FL',
      zip: '32202',
    },
    subscriber: {
      memberId: 'MEM8941029',
      firstName: 'JOHN',
      lastName: 'DOE',
      dateOfBirth: '1985-04-12',
      gender: 'M',
    },
    diagnoses: [{ code: 'J06.9' }],
    serviceLines: [
      {
        lineNumber: 1,
        serviceDate: '2026-09-10',
        procedureCode: '99213',
        modifier1: '25',
        quantity: 1,
        unitPrice: 100,
        diagnosisPointer: '1',
        placeOfService: PlaceOfService.OFFICE,
      },
      {
        lineNumber: 2,
        serviceDate: '2026-09-10',
        procedureCode: '36415',
        quantity: 2,
        unitPrice: 25,
        diagnosisPointer: '1',
      },
    ],
    totalCharge: 150,
    ...overrides,
  };
}

function segmentsOf(edi: string): string[] {
  return edi.split('~').filter((segment) => segment.length > 0);
}

describe('X12BuilderService 837P', () => {
  it('builds a 5010 professional envelope and claim loops', () => {
    const edi = service().build837Claim(claim());
    const segments = segmentsOf(edi);
    const isa = segments[0];
    const gs = segments.find((segment) => segment.startsWith('GS*'));
    const st = segments.find((segment) => segment.startsWith('ST*'));
    const se = segments.find((segment) => segment.startsWith('SE*'));
    const ge = segments.find((segment) => segment.startsWith('GE*'));
    const iea = segments.find((segment) => segment.startsWith('IEA*'));

    expect(isa.startsWith('ISA*00*          *00*          *ZZ*AV09311993     *01*030240928      *')).toBe(true);
    expect(isa.endsWith('*00501*000000001*1*T*:')).toBe(true);
    expect(isa.length + 1).toBe(106);
    expect(gs).toMatch(/^GS\*HC\*AV09311993\*030240928\*\d{8}\*\d{4}\*1\*X\*005010X222A1$/);
    expect(st).toBe('ST*837*000000001*005010X222A1');
    expect(segments).toContain('NM1*41*2*INTEGRATION POC HEALTH*****46*AV09311993');
    expect(segments).toContain('NM1*40*2*AVAILITY*****46*030240928');
    expect(segments).toContain('NM1*85*2*BILLING CLINIC*****XX*1234567893');
    expect(segments).toContain('REF*EI*123456789');
    expect(segments).toContain('NM1*IL*1*DOE*JOHN****MI*MEM8941029');
    expect(segments).toContain('DMG*D8*19850412*M');
    expect(segments).toContain('NM1*PR*2*PAYER*****PI*00001');
    expect(segments).toContain('CLM*PCN001*150***11:B:1*Y*A*Y*Y');
    expect(segments).toContain('HI*ABK:J069');
    expect(segments).toContain('SV1*HC:99213:25*100*UN*1***1');
    expect(segments).toContain('SV1*HC:36415*50*UN*2***1');
    expect(segments).toContain('DTP*472*D8*20260910');
    expect(se).toBe(`SE*${segments.findIndex((segment) => segment.startsWith('GE*')) - segments.findIndex((segment) => segment.startsWith('ST*'))}*000000001`);
    expect(ge).toBe('GE*1*1');
    expect(iea).toBe('IEA*1*000000001');
    expect(edi.endsWith('~')).toBe(true);
    expect(isa.includes('*^')).toBe(true);
  });

  it('rejects an invalid NPI before formatting', () => {
    expect(() =>
      service().build837Claim(
        claim({
          billingProvider: { ...claim().billingProvider, npi: '1234567890' },
        }),
      ),
    ).toThrow(BadRequestException);
  });

  it('rejects a tax id that is not a 9-digit EIN', () => {
    expect(() =>
      service().build837Claim(
        claim({
          billingProvider: { ...claim().billingProvider, taxId: '1234' },
        }),
      ),
    ).toThrow(BadRequestException);
  });

  it('rejects line charges that do not add up to the claim total', () => {
    expect(() => service().build837Claim(claim({ totalCharge: 10 }))).toThrow(BadRequestException);
  });

  it('rejects Availity edits for frequency 6, delimiters, and more than 50 lines', () => {
    const messageOf = (run: () => void): string => {
      try {
        run();
      } catch (error) {
        return JSON.stringify(error);
      }
      return '';
    };
    expect(messageOf(() => service().build837Claim(claim({ frequencyCode: ClaimFrequencyCode.CORRECTED })))).toMatch(/frequency code 6/);
    expect(messageOf(() => service().build837Claim(claim({ claimControlNumber: 'PCN*1' })))).toMatch(/delimiter/);
    expect(
      messageOf(() =>
        service().build837Claim(
          claim({
            serviceLines: Array.from({ length: 51 }, (_, index) => ({
              lineNumber: index + 1,
              serviceDate: '2026-09-10',
              procedureCode: '99213',
              quantity: 1,
              unitPrice: 1,
              diagnosisPointer: '1',
            })),
            totalCharge: 51,
          }),
        ),
      ),
    ).toMatch(/50 service lines/);
  });
});
