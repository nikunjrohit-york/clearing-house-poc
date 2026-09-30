import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { plainToInstance } from 'class-transformer';
import { validateSync, ValidationError } from 'class-validator';
import {
  EligibilityQueryDto,
  ProviderInfo,
  SubscriberInfo,
  DependentInfo,
  ServiceType,
} from './dto/eligibility-query.dto';
import {
  ClaimInputDto,
  ClaimProvider,
  ClaimSubscriber,
  ClaimDependent,
  ClaimServiceLine,
  ClaimType,
  PlaceOfService,
} from './dto/claim-input.dto';

const PROFESSIONAL_VERSION = '005010X222A1';
const DEFAULT_SUBMITTER_ID = 'AV09311993';
const DEFAULT_RECEIVER_ID = '030240928';

@Injectable()
export class X12BuilderService {
  private readonly logger = new Logger(X12BuilderService.name);
  private interchangeControlNumber = 0;
  private groupControlNumber = 0;
  private transactionControlNumber = 0;

  constructor(private readonly configService: ConfigService) {}

  private getNextInterchangeControlNumber(): string {
    this.interchangeControlNumber = (this.interchangeControlNumber % 999999999) + 1;
    return this.interchangeControlNumber.toString().padStart(9, '0');
  }

  private getNextGroupControlNumber(): string {
    this.groupControlNumber = (this.groupControlNumber % 999999999) + 1;
    return this.groupControlNumber.toString().padStart(9, '0');
  }

  private getNextTransactionControlNumber(): string {
    this.transactionControlNumber = (this.transactionControlNumber % 999999999) + 1;
    return this.transactionControlNumber.toString().padStart(9, '0');
  }

  private submitterId(): string {
    return this.text(this.configService.get<string>('AVAILITY_SUBMITTER_ID') || DEFAULT_SUBMITTER_ID);
  }

  private receiverId(): string {
    return this.text(this.configService.get<string>('AVAILITY_RECEIVER_ID') || DEFAULT_RECEIVER_ID);
  }

  private usageIndicator(): 'T' | 'P' {
    return this.configService.get<string>('AVAILITY_USAGE_INDICATOR') === 'P' ? 'P' : 'T';
  }

  private text(value: string | number | undefined | null): string {
    if (value === undefined || value === null) {
      return '';
    }
    return String(value).replace(/[~*^:]/g, '').trim();
  }

  private pad(value: string, length: number): string {
    return value.padEnd(length, ' ').slice(0, length);
  }

  private formatDate8(value: string | Date): string {
    if (typeof value === 'string') {
      const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
      if (iso) {
        return `${iso[1]}${iso[2]}${iso[3]}`;
      }
      const digits = value.replace(/\D/g, '');
      if (digits.length === 8) {
        return digits;
      }
    }
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException(`Invalid date: ${String(value)}`);
    }
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}${month}${day}`;
  }

  private formatDate6(value: string | Date): string {
    return this.formatDate8(value).slice(2);
  }

  private formatTime4(now = new Date()): string {
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    return `${hours}${minutes}`;
  }

  private money(amount: number): string {
    return (Math.round(amount * 100) / 100).toFixed(2);
  }

  private seg(id: string, elements: Array<string | number | null | undefined>): string {
    const values = elements.map((element) => (element === undefined || element === null ? '' : String(element)));
    while (values.length > 0 && values[values.length - 1] === '') {
      values.pop();
    }
    return values.length === 0 ? id : `${id}*${values.join('*')}`;
  }

  private buildIsa(icn: string, now: Date): string {
    const elements = [
      '00',
      '          ',
      '00',
      '          ',
      'ZZ',
      this.pad(this.submitterId(), 15),
      '01',
      this.pad(this.receiverId(), 15),
      this.formatDate6(now),
      this.formatTime4(now),
      '^',
      '00501',
      icn,
      '1',
      this.usageIndicator(),
      ':',
    ];
    return `ISA*${elements.join('*')}`;
  }

  private buildGs(functionalId: string, version: string, groupControlNumber: string, now: Date): string {
    return this.seg('GS', [
      functionalId,
      this.submitterId(),
      this.receiverId(),
      this.formatDate8(now),
      this.formatTime4(now),
      groupControlNumber,
      'X',
      version,
    ]);
  }

  private wrapTransaction(functionalId: string, version: string, transactionSetId: string, body: string[]): string {
    const now = new Date();
    const interchangeControlNumber = this.getNextInterchangeControlNumber();
    const groupControlNumber = this.getNextGroupControlNumber();
    const transactionControlNumber = this.getNextTransactionControlNumber();
    const transaction = [
      this.seg('ST', [transactionSetId, transactionControlNumber, version]),
      ...body,
    ];
    transaction.push(this.seg('SE', [String(transaction.length + 1), transactionControlNumber]));

    const segments = [
      this.buildIsa(interchangeControlNumber, now),
      this.buildGs(functionalId, version, groupControlNumber, now),
      ...transaction,
      this.seg('GE', ['1', groupControlNumber]),
      this.seg('IEA', ['1', interchangeControlNumber]),
    ];
    return `${segments.join('~')}~`;
  }

  private assertProfessionalClaim(dto: ClaimInputDto): ClaimInputDto {
    const claim = plainToInstance(ClaimInputDto, dto);
    const errors = validateSync(claim, { whitelist: true });
    if (errors.length > 0) {
      throw new BadRequestException(this.flattenValidationErrors(errors));
    }
    if (claim.claimType !== ClaimType.PROFESSIONAL) {
      throw new BadRequestException('build837Claim emits HIPAA 5010 837P professional claims (005010X222A1)');
    }
    return claim;
  }

  private flattenValidationErrors(errors: ValidationError[], prefix = ''): string[] {
    return errors.flatMap((error) => {
      const path = [prefix, error.property].filter((part) => part !== undefined && part !== '').join('.');
      const own = error.constraints ? Object.values(error.constraints).map((message) => (path ? `${path}: ${message}` : message)) : [];
      const children = error.children?.length ? this.flattenValidationErrors(error.children, path) : [];
      return [...own, ...children];
    });
  }

  build270EligibilityRequest(dto: EligibilityQueryDto): string {
    const now = new Date();
    const date = this.formatDate8(now);
    const time = this.formatTime4(now);
    const controlNumber = dto.referenceId || 'ELIG';
    const provider = dto.provider as ProviderInfo;
    const subscriber = dto.subscriber as SubscriberInfo;
    const body: string[] = [
      this.seg('BHT', ['0022', '13', this.text(controlNumber), date, time]),
      this.seg('HL', ['1', '', '20', '1']),
      this.seg('NM1', ['PR', '2', 'INFORMATION SOURCE', '', '', '', '', '46', this.text(dto.tradingPartnerId)]),
      this.seg('HL', ['2', '1', '21', '1']),
      this.seg('NM1', ['1P', '2', this.text(provider.name || 'PROVIDER NAME'), '', '', '', '', 'XX', this.text(provider.npi)]),
      this.seg('HL', ['3', '2', '22', dto.dependent ? '1' : '0']),
      this.seg('NM1', [
        'IL',
        '1',
        this.text(subscriber.lastName || 'LASTNAME'),
        this.text(subscriber.firstName || 'FIRSTNAME'),
        '',
        '',
        '',
        'MI',
        this.text(subscriber.memberId),
      ]),
    ];

    if (subscriber.dateOfBirth || subscriber.gender) {
      body.push(
        this.seg('DMG', [
          'D8',
          subscriber.dateOfBirth ? this.formatDate8(subscriber.dateOfBirth) : '',
          this.text(subscriber.gender).toUpperCase(),
        ]),
      );
    }

    if (dto.dependent) {
      const dependent = dto.dependent as DependentInfo;
      body.push(
        this.seg('HL', ['4', '3', '23', '0']),
        this.seg('NM1', [
          '03',
          '1',
          this.text(dependent.lastName),
          this.text(dependent.firstName),
          '',
          '',
          '',
          'MI',
          this.text(dependent.memberId),
        ]),
        this.seg('DMG', ['D8', this.formatDate8(dependent.dateOfBirth), this.text(dependent.gender).toUpperCase()]),
      );
    }

    const serviceType = dto.serviceType || ServiceType.MEDICAL_CARE;
    body.push(this.seg('EQ', [serviceType, '', '', '', '', '30']));
    if (dto.serviceDate) {
      body.push(this.seg('DTP', ['291', 'D8', this.formatDate8(dto.serviceDate)]));
    }

    return this.wrapTransaction('HS', '005010X279A1', '270', body);
  }

  build837Claim(dto: ClaimInputDto): string {
    const claim = this.assertProfessionalClaim(dto);
    const now = new Date();
    const date = this.formatDate8(now);
    const time = this.formatTime4(now);
    const billing = claim.billingProvider as ClaimProvider;
    const subscriber = claim.subscriber as ClaimSubscriber;
    const placeOfService = this.text(claim.serviceLines.find((line) => line.placeOfService)?.placeOfService || PlaceOfService.OFFICE);
    const body: string[] = [
      this.seg('BHT', ['0019', '00', this.text(claim.claimControlNumber), date, time, 'CH']),
      this.seg('NM1', ['41', '2', 'INTEGRATION POC HEALTH', '', '', '', '', '46', this.submitterId()]),
      this.seg('PER', ['IC', 'EDI OPERATIONS', 'TE', '8005551212']),
      this.seg('NM1', ['40', '2', 'AVAILITY', '', '', '', '', '46', this.receiverId()]),
      ...this.billingProviderLoops(billing),
      ...this.subscriberLoops(claim, subscriber),
      this.seg('CLM', [
        this.text(claim.claimControlNumber),
        this.money(claim.totalCharge),
        '',
        '',
        `${placeOfService}:B:${this.text(claim.frequencyCode)}`,
        'Y',
        'A',
        'Y',
        'Y',
      ]),
      this.seg(
        'HI',
        claim.diagnoses.map((diagnosis, index) => {
          const qualifier = index === 0 ? 'ABK' : 'ABF';
          return `${qualifier}:${this.text(diagnosis.code).replace(/\./g, '')}`;
        }),
      ),
    ];

    if (claim.patientAccountNumber && this.text(claim.patientAccountNumber) !== this.text(claim.claimControlNumber)) {
      body.push(this.seg('REF', ['EA', this.text(claim.patientAccountNumber)]));
    }

    if (claim.renderingProvider?.npi) {
      body.push(
        this.seg('NM1', [
          '82',
          '2',
          this.text(claim.renderingProvider.name || 'RENDERING PROVIDER'),
          '',
          '',
          '',
          '',
          'XX',
          this.text(claim.renderingProvider.npi),
        ]),
      );
    }

    claim.serviceLines.forEach((line, index) => body.push(...this.serviceLineLoops(line, index)));

    const edi = this.wrapTransaction('HC', PROFESSIONAL_VERSION, '837', body);
    this.logger.log(`Built 837P claim ${claim.claimControlNumber} for payer ${claim.tradingPartnerId}`);
    return edi;
  }

  private billingProviderLoops(billing: ClaimProvider): string[] {
    const segments = [
      this.seg('HL', ['1', '', '20', '1']),
    ];
    if (billing.specialty) {
      segments.push(this.seg('PRV', ['BI', 'PXC', this.text(billing.specialty)]));
    }
    segments.push(
      this.seg('NM1', ['85', '2', this.text(billing.name || 'BILLING PROVIDER'), '', '', '', '', 'XX', this.text(billing.npi)]),
    );
    if (billing.address1) {
      segments.push(this.seg('N3', [this.text(billing.address1), this.text(billing.address2)]));
      segments.push(this.seg('N4', [this.text(billing.city), this.text(billing.state).toUpperCase(), this.text(billing.zip).replace(/-/g, '')]));
    }
    segments.push(this.seg('REF', ['EI', this.text(billing.taxId).replace(/\D/g, '')]));
    return segments;
  }

  private subscriberLoops(claim: ClaimInputDto, subscriber: ClaimSubscriber): string[] {
    const segments = [
      this.seg('HL', ['2', '1', '22', claim.dependent ? '1' : '0']),
      this.seg('SBR', ['P', '18', '', '', '', '', '', '', 'CI']),
      this.seg('NM1', [
        'IL',
        '1',
        this.text(subscriber.lastName),
        this.text(subscriber.firstName),
        '',
        '',
        '',
        'MI',
        this.text(subscriber.memberId),
      ]),
    ];
    if (subscriber.address1) {
      segments.push(this.seg('N3', [this.text(subscriber.address1), this.text(subscriber.address2)]));
      segments.push(
        this.seg('N4', [this.text(subscriber.city), this.text(subscriber.state).toUpperCase(), this.text(subscriber.zip).replace(/-/g, '')]),
      );
    }
    if (subscriber.dateOfBirth || subscriber.gender) {
      segments.push(
        this.seg('DMG', [
          'D8',
          subscriber.dateOfBirth ? this.formatDate8(subscriber.dateOfBirth) : '',
          this.text(subscriber.gender).toUpperCase(),
        ]),
      );
    }
    segments.push(this.seg('NM1', ['PR', '2', 'PAYER', '', '', '', '', 'PI', this.text(claim.tradingPartnerId)]));
    if (claim.dependent) {
      segments.push(...this.dependentLoops(claim.dependent));
    }
    return segments;
  }

  private dependentLoops(dependent: ClaimDependent): string[] {
    return [
      this.seg('HL', ['3', '2', '23', '0']),
      this.seg('PAT', [this.text(dependent.relationship || '19')]),
      this.seg('NM1', [
        'QC',
        '1',
        this.text(dependent.lastName),
        this.text(dependent.firstName),
        '',
        '',
        '',
        'MI',
        this.text(dependent.memberId),
      ]),
      this.seg('DMG', ['D8', this.formatDate8(dependent.dateOfBirth), this.text(dependent.gender).toUpperCase()]),
    ];
  }

  private serviceLineLoops(line: ClaimServiceLine, index: number): string[] {
    const modifiers = [line.modifier1, line.modifier2, line.modifier3, line.modifier4]
      .map((modifier) => this.text(modifier))
      .filter((modifier) => modifier !== '');
    const procedure = ['HC', this.text(line.procedureCode), ...modifiers].join(':');
    const lineCharge = Math.round(line.quantity * line.unitPrice * 100) / 100;
    const segments = [
      this.seg('LX', [String(line.lineNumber || index + 1)]),
      this.seg('SV1', [
        procedure,
        this.money(lineCharge),
        'UN',
        String(line.quantity),
        '',
        '',
        this.text(line.diagnosisPointer || '1'),
      ]),
      this.seg('DTP', ['472', 'D8', this.formatDate8(line.serviceDate)]),
    ];
    if (line.npi) {
      segments.push(this.seg('REF', ['G2', this.text(line.npi)]));
    }
    return segments;
  }

  build276ClaimStatusRequest(
    tradingPartnerId: string,
    providerNpi: string,
    patientId: string,
    claimControlNumber: string,
    serviceDate: string,
  ): string {
    const now = new Date();
    const date = this.formatDate8(now);
    const time = this.formatTime4(now);
    const body = [
      this.seg('BHT', ['0010', '13', this.text(claimControlNumber), date, time]),
      this.seg('HL', ['1', '', '20', '1']),
      this.seg('NM1', ['PR', '2', 'PAYER NAME', '', '', '', '', '46', this.text(tradingPartnerId)]),
      this.seg('HL', ['2', '1', '21', '1']),
      this.seg('NM1', ['41', '2', 'PROVIDER NAME', '', '', '', '', 'XX', this.text(providerNpi)]),
      this.seg('HL', ['3', '2', '22', '0']),
      this.seg('NM1', ['QC', '1', 'PATIENT LAST', 'PATIENT FIRST', '', '', '', 'MI', this.text(patientId)]),
      this.seg('HL', ['4', '3', '19', '0']),
      this.seg('TRN', ['1', this.text(claimControlNumber)]),
      this.seg('DTP', ['472', 'D8', this.formatDate8(serviceDate)]),
    ];
    return this.wrapTransaction('HR', '005010X212', '276', body);
  }
}
