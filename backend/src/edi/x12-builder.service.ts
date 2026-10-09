import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
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
  BillingProvider,
  ClaimAddress,
  ClaimInputDto,
  ClaimSubscriber,
  ClaimDependent,
  ClaimServiceLine,
  ClaimType,
  ClaimFrequencyCode,
  PlaceOfService,
} from './dto/claim-input.dto';

const PROFESSIONAL_VERSION = '005010X222A1';

@Injectable()
export class X12BuilderService {
  private readonly logger = new Logger(X12BuilderService.name);
  private interchangeControlNumber = 0;
  private groupControlNumber = 0;
  private transactionControlNumber = 0;

  constructor(private readonly configService: ConfigService) {
    // Companion Guide §3.4: a reused ISA13 is rejected as a duplicate file. Tests keep a deterministic counter.
    if (process.env.NODE_ENV === 'test') {
      return;
    }
    this.restoreControlNumbers();
  }

  private controlNumberStore(): string {
    return (
      this.configService.get<string>('AVAILITY_CONTROL_NUMBER_STORE') ||
      path.join(process.cwd(), '.availity-control-numbers.json')
    );
  }

  private restoreControlNumbers(): void {
    const store = this.controlNumberStore();
    try {
      const saved = JSON.parse(fs.readFileSync(store, 'utf8')) as {
        interchange?: number;
        group?: number;
        transaction?: number;
      };
      this.interchangeControlNumber = Number(saved.interchange) || 0;
      this.groupControlNumber = Number(saved.group) || 0;
      this.transactionControlNumber = Number(saved.transaction) || 0;
    } catch {
      const seed = Number(String(Date.now()).slice(-9)) || 1;
      this.interchangeControlNumber = seed;
      this.groupControlNumber = seed;
      this.transactionControlNumber = seed;
    }
  }

  private persistControlNumbers(): void {
    if (process.env.NODE_ENV === 'test') {
      return;
    }
    const store = this.controlNumberStore();
    fs.writeFileSync(
      store,
      JSON.stringify({
        interchange: this.interchangeControlNumber,
        group: this.groupControlNumber,
        transaction: this.transactionControlNumber,
      }),
    );
  }

  private getNextInterchangeControlNumber(): string {
    this.interchangeControlNumber = (this.interchangeControlNumber % 999999999) + 1;
    return this.interchangeControlNumber.toString().padStart(9, '0');
  }

  // Companion Guide §3.6 / prompt GS06: unique, no leading zeroes, and equal to GE02.
  private getNextGroupControlNumber(): string {
    this.groupControlNumber = (this.groupControlNumber % 999999999) + 1;
    return String(this.groupControlNumber);
  }

  private getNextTransactionControlNumber(): string {
    this.transactionControlNumber = (this.transactionControlNumber % 999999999) + 1;
    return this.transactionControlNumber.toString().padStart(9, '0');
  }

  private submitterId(): string {
    return this.requiredConfig('AVAILITY_SUBMITTER_ID');
  }

  /** Loop 2010BB NM109. Blank or the rejected placeholder 00001 uses AVAILITY_PAYER_ID. GS03 stays the Availity receiver id. */
  professionalPayerId(requested?: string): string {
    const configured = this.configService.get<string>('AVAILITY_PAYER_ID')?.trim() || 'AVAILITY';
    const submitted = requested?.trim() ?? '';
    if (!submitted || submitted === '00001') {
      return configured;
    }
    return submitted;
  }

  usesQaPayerList(): boolean {
    return this.usageIndicator() === 'T' && process.env.NODE_ENV !== 'test';
  }

  private receiverId(): string {
    return this.requiredConfig('AVAILITY_RECEIVER_ID');
  }

  private requiredConfig(key: string): string {
    const value = this.text(this.configService.get<string>(key));
    if (!value) {
      throw new BadRequestException(`${key} is required`);
    }
    return value;
  }

  private requiredText(value: string | undefined | null, label: string): string {
    const text = this.text(value);
    if (!text) {
      throw new BadRequestException(`${label} is required`);
    }
    return text;
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

  // ISA02/04/06/08 are fixed-width. Trim configured ids, then right-pad. Never trim the padded result.
  private fixedField(value: string | undefined | null, length: number, label: string, allowBlank = false): string {
    const trimmed = allowBlank ? (value ?? '') : (value?.trim() ?? '');
    if (!allowBlank && !trimmed) {
      throw new BadRequestException(`${label} is required`);
    }
    if (trimmed.length > length) {
      throw new BadRequestException(`${label} is ${trimmed.length} characters; the fixed field allows ${length}`);
    }
    const padded = trimmed.padEnd(length, ' ');
    if (padded.length !== length || (!allowBlank && padded.trimEnd() !== trimmed)) {
      throw new BadRequestException(`${label} must be right-padded with spaces to ${length} characters`);
    }
    return padded;
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

  // GS05 is HHMM in GMT. ISA09/ISA10 time zone is not stated separately, so both envelope clocks use UTC.
  private formatUtcDate8(now: Date): string {
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    const day = String(now.getUTCDate()).padStart(2, '0');
    return `${year}${month}${day}`;
  }

  private formatUtcDate6(now: Date): string {
    return this.formatUtcDate8(now).slice(2);
  }

  private formatUtcTime4(now: Date): string {
    const hours = String(now.getUTCHours()).padStart(2, '0');
    const minutes = String(now.getUTCMinutes()).padStart(2, '0');
    return `${hours}${minutes}`;
  }

  // Companion Guide §3.7: whole-dollar amounts have no decimal; cents are rounded to 2 places.
  private formatTime4(now = new Date()): string {
    return this.formatUtcTime4(now);
  }

  private assertEnvelopeEnvironment(): void {
    const host = this.configService.get<string>('AVAILITY_SFTP_HOST')?.trim();
    if (!host) {
      throw new BadRequestException('AVAILITY_SFTP_HOST is required');
    }
    const usage = this.usageIndicator();
    if (this.configService.get<string>('AVAILITY_ALLOW_ENV_MISMATCH') === 'true') {
      return;
    }
    // Case 18993019: QA host is qa-files.availity.com and production is files.availity.com. ISA15 must match.
    if (host === 'qa-files.availity.com' && usage === 'P') {
      throw new BadRequestException('ISA15=P cannot be sent to qa-files.availity.com without AVAILITY_ALLOW_ENV_MISMATCH=true');
    }
    if (host === 'files.availity.com' && usage === 'T') {
      throw new BadRequestException('ISA15=T cannot be sent to files.availity.com without AVAILITY_ALLOW_ENV_MISMATCH=true');
    }
    this.fixedField(this.configService.get<string>('AVAILITY_SUBMITTER_ID'), 15, 'ISA06');
    this.fixedField(this.configService.get<string>('AVAILITY_RECEIVER_ID'), 15, 'ISA08');
  }

  // Companion Guide §3.7. Field names are included so the API can show which edit failed.
  private assertAvailityEdits(claim: ClaimInputDto): void {
    const problems: string[] = [];
    if (claim.frequencyCode === ClaimFrequencyCode.CORRECTED) {
      problems.push('frequencyCode: claim frequency code 6 is not accepted');
    }
    if (claim.serviceLines.length > 50) {
      problems.push('serviceLines: a professional claim can contain at most 50 service lines');
    }
    if (claim.tradingPartnerId.trim().toUpperCase() === 'XV') {
      problems.push('tradingPartnerId: National Plan ID qualifier XV is not accepted');
    }
    const primary = claim.diagnoses[0]?.code?.replace(/\./g, '') ?? '';
    if (/^E/i.test(primary)) {
      problems.push('diagnoses[0].code: an E code cannot be the primary diagnosis');
    }
    const today = this.formatUtcDate8(new Date());
    const dates: Array<[string, string | undefined]> = [
      ['subscriber.birthDate', claim.subscriber?.birthDate],
      ['admissionDate', claim.admissionDate],
      ['dischargeDate', claim.dischargeDate],
      ...claim.serviceLines.map((line, index) => [`serviceLines[${index}].serviceDate`, line.serviceDate] as [string, string]),
    ];
    for (const [field, value] of dates) {
      if (!value) {
        continue;
      }
      const formatted = this.formatDate8(value);
      if (formatted >= today) {
        problems.push(`${field}: date ${formatted} must be before the transaction creation date ${today}`);
      }
    }
    const zipFields: Array<[string, string | undefined]> = [
      ['billingProvider.address.zip', claim.billingProvider?.address?.zip],
      ['subscriber.address.zip', claim.subscriber?.address?.zip],
    ];
    for (const [field, zip] of zipFields) {
      if (zip?.includes('-')) {
        problems.push(`${field}: ZIP codes cannot contain a dash`);
      }
    }
    const inpatient = claim.serviceLines.some((line) => line.placeOfService === PlaceOfService.INPATIENT_HOSPITAL);
    if (inpatient && !claim.admissionDate) {
      problems.push('admissionDate: an admission date is required on inpatient claims');
    }
    const medicare = /medicare/i.test(claim.tradingPartnerId) || claim.tradingPartnerId.trim().toUpperCase() === 'CMS';
    const memberId = claim.subscriber?.memberId?.replace(/-/g, '') ?? '';
    if (medicare && /^\d{9}$/.test(memberId)) {
      // UNCONFIRMED: which payer IDs count as Medicare. Matched only on the trading-partner text above.
      problems.push('subscriber.memberId: a subscriber SSN is not accepted on Medicare claims');
    }
    if (claim.oxygenTherapy) {
      problems.push('oxygenTherapy: CR5/2400E mapping is UNCONFIRMED, so oxygen claims are rejected instead of emitted incomplete');
    }
    if (claim.homeHealth) {
      problems.push('homeHealth: CR6 mapping is UNCONFIRMED, so home health claims are rejected instead of emitted incomplete');
    }
    this.collectDelimiterProblems(claim, 'claim', problems);
    if (problems.length > 0) {
      throw new BadRequestException(problems);
    }
  }

  private collectDelimiterProblems(value: unknown, field: string, problems: string[]): void {
    if (typeof value === 'string' && /[~*^:]/.test(value)) {
      problems.push(`${field}: value contains a delimiter (~ * ^ :) and cannot be sent`);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((entry, index) => this.collectDelimiterProblems(entry, `${field}[${index}]`, problems));
      return;
    }
    if (value && typeof value === 'object') {
      Object.entries(value as Record<string, unknown>).forEach(([key, entry]) => {
        this.collectDelimiterProblems(entry, `${field}.${key}`, problems);
      });
    }
  }

  private money(amount: number): string {
    const rounded = Math.round(amount * 100) / 100;
    if (Number.isInteger(rounded)) {
      return String(rounded);
    }
    return rounded.toFixed(2);
  }

  private seg(id: string, elements: Array<string | number | null | undefined>): string {
    const values = elements.map((element) => (element === undefined || element === null ? '' : String(element)));
    while (values.length > 0 && values[values.length - 1] === '') {
      values.pop();
    }
    return values.length === 0 ? id : `${id}*${values.join('*')}`;
  }

  private buildIsa(icn: string, now: Date): string {
    const senderQualifier = 'ZZ';
    const senderId = this.fixedField(this.configService.get<string>('AVAILITY_SUBMITTER_ID'), 15, 'ISA06');
    const receiverQualifier = '01';
    const receiverId = this.fixedField(this.configService.get<string>('AVAILITY_RECEIVER_ID'), 15, 'ISA08');
    const elements = [
      '00',
      this.fixedField(' '.repeat(10), 10, 'ISA02', true),
      '00',
      this.fixedField(' '.repeat(10), 10, 'ISA04', true),
      senderQualifier,
      senderId,
      receiverQualifier,
      receiverId,
      this.formatUtcDate6(now),
      this.formatUtcTime4(now),
      '^',
      '00501',
      icn,
      '1',
      this.usageIndicator(),
      ':',
    ];
    const isa = `ISA*${elements.join('*')}`;
    this.assertIsaSegment(isa, senderQualifier, senderId, receiverQualifier, receiverId);
    return isa;
  }

  private assertIsaSegment(
    isa: string,
    senderQualifier: string,
    senderId: string,
    receiverQualifier: string,
    receiverId: string,
  ): void {
    if (isa.includes('\r') || isa.includes('\n')) {
      throw new BadRequestException('ISA segment must not contain line breaks');
    }
    // 105 characters plus the '~' terminator is the 106-character ISA record.
    if (isa.length !== 105) {
      throw new BadRequestException(`ISA segment must be 105 characters before the terminator, received ${isa.length}`);
    }
    const elements = isa.split('*');
    if (elements.length !== 17 || elements[0] !== 'ISA') {
      throw new BadRequestException('ISA element delimiter shifted the fixed fields');
    }
    if (elements[2].length !== 10 || elements[4].length !== 10) {
      throw new BadRequestException('ISA02 and ISA04 must be 10 characters');
    }
    if (elements[5] !== senderQualifier) {
      throw new BadRequestException('ISA05 Interchange ID Qualifier must be ZZ');
    }
    if (elements[6].length !== 15 || elements[6] !== senderId) {
      throw new BadRequestException(`ISA06 Interchange Sender ID must be 15 characters, received ${elements[6].length}`);
    }
    if (elements[7] !== receiverQualifier) {
      throw new BadRequestException('ISA07 Interchange ID Qualifier must be 01');
    }
    if (elements[8].length !== 15 || elements[8] !== receiverId) {
      throw new BadRequestException(`ISA08 Interchange Receiver ID must be 15 characters, received ${elements[8].length}`);
    }
  }

  private buildGs(functionalId: string, version: string, groupControlNumber: string, now: Date): string {
    return this.seg('GS', [
      functionalId,
      this.submitterId(),
      this.receiverId(),
      this.formatUtcDate8(now),
      this.formatUtcTime4(now),
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
    this.persistControlNumbers();

    const segments = [
      this.buildIsa(interchangeControlNumber, now),
      this.buildGs(functionalId, version, groupControlNumber, now),
      ...transaction,
      this.seg('GE', ['1', groupControlNumber]),
      this.seg('IEA', ['1', interchangeControlNumber]),
    ];
    const edi = `${segments.join('~')}~`;
    if (/[\r\n]/.test(edi)) {
      throw new BadRequestException('X12 interchange must not contain line breaks');
    }
    return edi;
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
    this.assertEnvelopeEnvironment();
    this.assertAvailityEdits(claim);
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
    const controlNumber = this.requiredText(dto.referenceId, 'Eligibility reference id');
    const provider = dto.provider as ProviderInfo;
    const subscriber = dto.subscriber as SubscriberInfo;
    const body: string[] = [
      this.seg('BHT', ['0022', '13', this.text(controlNumber), date, time]),
      this.seg('HL', ['1', '', '20', '1']),
      this.seg('NM1', ['PR', '2', 'INFORMATION SOURCE', '', '', '', '', '46', this.text(dto.tradingPartnerId)]),
      this.seg('HL', ['2', '1', '21', '1']),
      this.seg('NM1', ['1P', '2', this.requiredText(provider.name, 'Provider name'), '', '', '', '', 'XX', this.text(provider.npi)]),
      this.seg('HL', ['3', '2', '22', dto.dependent ? '1' : '0']),
      this.seg('NM1', [
        'IL',
        '1',
        this.requiredText(subscriber.lastName, 'Subscriber last name'),
        this.requiredText(subscriber.firstName, 'Subscriber first name'),
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
    const billing = claim.billingProvider as BillingProvider;
    const subscriber = claim.subscriber as ClaimSubscriber;
    const placeOfService = this.requiredText(claim.placeOfService, 'Place of service');
    const body: string[] = [
      this.seg('BHT', ['0019', '00', this.text(claim.claimControlNumber), date, time, 'CH']),
      this.seg('NM1', ['41', '2', this.requiredText(billing.name, 'Billing provider name'), '', '', '', '', '46', this.submitterId()]),
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
          this.requiredText(claim.renderingProvider.name, 'Rendering provider name'),
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
    this.logger.log(`Built 837P claim ${claim.claimControlNumber} for payer ${this.professionalPayerId(claim.tradingPartnerId)}`);
    return edi;
  }

  private addressSegments(address: ClaimAddress | undefined): string[] {
    if (!address?.address1) {
      return [];
    }
    return [
      this.seg('N3', [this.text(address.address1), this.text(address.address2)]),
      this.seg('N4', [this.text(address.city), this.text(address.state).toUpperCase(), this.text(address.zip).replace(/-/g, '')]),
    ];
  }

  private billingProviderLoops(billing: BillingProvider): string[] {
    const segments = [
      this.seg('HL', ['1', '', '20', '1']),
    ];
    if (billing.specialty) {
      segments.push(this.seg('PRV', ['BI', 'PXC', this.text(billing.specialty)]));
    }
    segments.push(
      this.seg('NM1', ['85', '2', this.requiredText(billing.name, 'Billing provider name'), '', '', '', '', 'XX', this.text(billing.npi)]),
    );
    segments.push(...this.addressSegments(billing.address));
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
    segments.push(...this.addressSegments(subscriber.address));
    segments.push(
      this.seg('DMG', ['D8', this.formatDate8(subscriber.birthDate), this.text(subscriber.gender).toUpperCase()]),
    );
    segments.push(
      this.seg('NM1', ['PR', '2', 'PAYER', '', '', '', '', 'PI', this.professionalPayerId(claim.tradingPartnerId)]),
    );
    if (claim.dependent) {
      segments.push(...this.dependentLoops(claim.dependent));
    }
    return segments;
  }

  private dependentLoops(dependent: ClaimDependent): string[] {
    return [
      this.seg('HL', ['3', '2', '23', '0']),
      this.seg('PAT', [this.requiredText(dependent.relationship, 'Dependent relationship')]),
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
    const procedure = ['HC', this.text(line.procedureCode).replace(/\./g, ''), ...modifiers].join(':');
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
        this.requiredText(line.diagnosisPointer, 'Diagnosis pointer'),
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
    void tradingPartnerId;
    void providerNpi;
    void patientId;
    void claimControlNumber;
    void serviceDate;
    throw new BadRequestException(
      'Refusing to build a 276 with synthesized payer, provider, or patient names. Use the Availity claim-status REST API.',
    );
  }
}
