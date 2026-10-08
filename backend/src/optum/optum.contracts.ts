import { HttpException } from '@nestjs/common';

// Request bodies follow the Optum Medical Network examples.
// Response fields follow the JSON those APIs return.

export interface OptumCall {
  at: string;
  method: 'GET' | 'POST';
  path: string;
  httpStatus: number;
  request?: unknown;
  data: unknown;
}

export class OptumRequestError extends HttpException {
  step = 'optum';

  constructor(readonly call: OptumCall) {
    const optum = readOptumError(call.data, call.httpStatus);
    super(
      {
        statusCode: call.httpStatus,
        message: optum.description || optum.error || `Optum request failed (${call.httpStatus})`,
        ...optum,
        details: call.data ?? null,
      },
      call.httpStatus,
    );
  }
}

export interface OptumErrorBody {
  httpStatus: number;
  description: string;
  error: string;
  traceId: string;
  applicationMode: string;
}

export interface MoneyBenefit {
  name: string;
  coverageLevel: string;
  serviceTypes: string[];
  amount: string;
  percent: string;
  timeQualifier: string;
  network: string;
}

export interface EligibilityModel {
  activeCoverage: { statusCode: string; status: string; serviceTypeCodes: string[] }[];
  copays: MoneyBenefit[];
  deductibles: MoneyBenefit[];
  coinsurance: MoneyBenefit[];
  outOfPocketMaximums: MoneyBenefit[];
}

export interface ClaimWarning {
  field: string;
  code: string;
  description: string;
  location: string;
}

export interface ClaimSubmissionModel {
  claimControlNumber: string;
  submissionStatus: string;
  warnings: ClaimWarning[];
}

export interface StatusLine {
  categoryCode: string;
  category: string;
  statusCode: string;
  description: string;
}

export interface Report277Model {
  acknowledgements: StatusLine[];
  rejections: StatusLine[];
  otherStatuses: StatusLine[];
  fieldErrors: ClaimWarning[];
}

export interface ClaimStatusModel {
  adjudication: {
    categoryCode: string;
    category: string;
    statusCode: string;
    description: string;
    payerClaimControlNumber: string;
    claimServiceDate: string;
    submittedAmount: string;
    amountPaid: string;
    paidDate: string;
    checkIssueDate: string;
    checkNumber: string;
  }[];
}

export interface Adjustment {
  group: string;
  groupValue: string;
  reasonCode: string;
  amount: string;
}

export interface RemittanceModel {
  traceNumber: string;
  paymentMethod: string;
  totalPaidAmount: string;
  adjustments: Adjustment[];
  remarkCodes: string[];
}

export function eligibilityRequest(tradingPartnerServiceId: string): Record<string, unknown> {
  return {
    controlNumber: '123456789',
    tradingPartnerServiceId,
    provider: {
      organizationName: 'provider_name',
      npi: '0123456789',
      serviceProviderNumber: '54321',
      providerCode: 'AD',
      referenceIdentification: '54321g',
    },
    subscriber: {
      memberId: '0000000000',
      firstName: 'johnOne',
      lastName: 'doeOne',
      gender: 'M',
      dateOfBirth: '18800102',
      ssn: '555443333',
      idCard: 'card123',
    },
    dependents: [
      {
        firstName: 'janeOne',
        lastName: 'doeone',
        gender: 'F',
        dateOfBirth: '18160421',
        groupNumber: '1111111111',
      },
    ],
    encounter: {
      beginningDateOfService: '20100101',
      endDateOfService: '20100102',
      serviceTypeCodes: ['98'],
    },
  };
}

export function professionalClaimRequest(): Record<string, unknown> {
  return {
    controlNumber: '000000001',
    tradingPartnerServiceId: '9496',
    submitter: {
      organizationName: 'REGIONAL PPO NETWORK',
      contactInformation: { name: 'SUBMITTER CONTACT INFO', phoneNumber: '123456789' },
    },
    receiver: { organizationName: 'EXTRA HEALTHY INSURANCE' },
    subscriber: {
      memberId: '0000000001',
      paymentResponsibilityLevelCode: 'P',
      firstName: 'johnone',
      lastName: 'doeOne',
      gender: 'M',
      dateOfBirth: '19800102',
      policyNumber: '00001',
      address: { address1: '123 address1', city: 'city1', state: 'wa', postalCode: '981010000' },
    },
    dependent: {
      memberId: '0000000002',
      paymentResponsibilityLevelCode: 'P',
      firstName: 'janeone',
      lastName: 'doeOne',
      gender: 'F',
      dateOfBirth: '19800102',
      policyNumber: '00002',
      relationshipToSubscriberCode: '01',
      address: { address1: '123 address1', city: 'city1', state: 'wa', postalCode: '981010000' },
    },
    providers: [
      {
        providerType: 'BillingProvider',
        npi: '1760854442',
        employerId: '123456789',
        organizationName: 'HAPPY DOCTORS GROUPPRACTICE',
        address: { address1: '000 address1', city: 'city2', state: 'tn', postalCode: '372030000' },
        contactInformation: { name: 'janetwo doetwo', phoneNumber: '0000000001' },
      },
      {
        providerType: 'ReferringProvider',
        npi: '1942788757',
        firstName: 'johntwo',
        lastName: 'doetwo',
        employerId: '123456',
      },
      {
        providerType: 'RenderingProvider',
        npi: '1942788757',
        firstName: 'janetwo',
        lastName: 'doetwo',
        middleName: 'middletwo',
        ssn: '000000000',
      },
    ],
    claimInformation: {
      claimFilingCode: 'CI',
      patientControlNumber: '12345',
      claimChargeAmount: '28.75',
      placeOfServiceCode: '11',
      claimFrequencyCode: '1',
      signatureIndicator: 'Y',
      planParticipationCode: 'A',
      benefitsAssignmentCertificationIndicator: 'Y',
      releaseInformationCode: 'Y',
      claimSupplementalInformation: { repricedClaimNumber: '00001', claimNumber: '12345' },
      healthCareCodeInformation: [
        { diagnosisTypeCode: 'BK', diagnosisCode: '496' },
        { diagnosisTypeCode: 'BF', diagnosisCode: '25000' },
      ],
      serviceFacilityLocation: {
        organizationName: 'HAPPY DOCTORS GROUP',
        address: { address1: '000 address1', city: 'city2', state: 'tn', postalCode: '372030000' },
      },
      serviceLines: [
        {
          serviceDate: '20050514',
          professionalService: {
            procedureIdentifier: 'HC',
            lineItemChargeAmount: '25',
            procedureCode: 'E0570',
            measurementUnit: 'UN',
            serviceUnitCount: '1',
            compositeDiagnosisCodePointers: { diagnosisCodePointers: ['1', '2'] },
          },
        },
        {
          serviceDate: '20050514',
          professionalService: {
            procedureIdentifier: 'HC',
            lineItemChargeAmount: '3.75',
            procedureCode: 'A7003',
            measurementUnit: 'UN',
            serviceUnitCount: '1',
            compositeDiagnosisCodePointers: { diagnosisCodePointers: ['1'] },
          },
        },
      ],
    },
  };
}

export function claimStatusRequest(submittedAmount: string): Record<string, unknown> {
  return {
    controlNumber: '000000001',
    tradingPartnerServiceId: 'serviceId',
    providers: [
      { organizationName: 'TestProvider', taxId: '0123456789', providerType: 'BillingProvider' },
      { organizationName: 'happy doctors group', npi: '1760854442', providerType: 'ServiceProvider' },
    ],
    subscriber: {
      memberId: '0000000000',
      firstName: 'johnone',
      lastName: 'doeone',
      gender: 'M',
      dateOfBirth: '18800102',
      groupNumber: '0000000000',
    },
    dependent: {
      firstName: 'janeone',
      lastName: 'doeone',
      gender: 'F',
      dateOfBirth: '18800101',
      groupNumber: '0000000000',
    },
    encounter: {
      beginningDateOfService: '20100101',
      endDateOfService: '20100102',
      trackingNumber: 'ABCD',
      submittedAmount,
    },
  };
}

export function readOptumError(data: unknown, httpStatus: number): OptumErrorBody {
  const body = record(data);
  const meta = record(body?.meta);
  return {
    httpStatus,
    description: text(body?.description || body?.error_description || body?.message),
    error: text(body?.error),
    traceId: text(body?.traceId || meta?.traceId),
    applicationMode: text(meta?.applicationMode),
  };
}

export function parseEligibility(raw: unknown): EligibilityModel {
  const root = record(raw);
  const benefits = records(root?.benefitsInformation);
  const activeCoverage = [
    ...records(root?.planStatus)
      .filter((status) => text(status.statusCode) === '1' || /active coverage/i.test(text(status.status)))
      .map((status) => ({
        statusCode: text(status.statusCode),
        status: text(status.status),
        serviceTypeCodes: texts(status.serviceTypeCodes),
      })),
    ...benefits
      .filter((benefit) => text(benefit.code) === '1')
      .map((benefit) => ({
        statusCode: '1',
        status: text(benefit.name) || 'Active Coverage',
        serviceTypeCodes: texts(benefit.serviceTypeCodes),
      })),
  ];
  const money = (code: string) => benefits.filter((benefit) => text(benefit.code) === code).map(toMoney);
  return {
    activeCoverage,
    copays: money('B'),
    deductibles: money('C'),
    coinsurance: money('A'),
    outOfPocketMaximums: money('G'),
  };
}

export function parseClaimSubmission(raw: unknown): ClaimSubmissionModel {
  const root = record(raw);
  const claimReference = record(root?.claimReference);
  return {
    claimControlNumber: text(claimReference?.rhclaimNumber || claimReference?.rhClaimNumber),
    submissionStatus: text(root?.status || root?.editStatus),
    warnings: [...records(root?.errors), ...records(root?.editResponses), ...records(root?.warnings)]
      .map((item) => ({
        field: text(item.field),
        code: text(item.code),
        description: text(item.description || item.errorDescription || item.message),
        location: text(item.location),
      }))
      .filter((item) => item.field || item.code || item.description),
  };
}

export function parse277(raw: unknown): Report277Model {
  const acknowledgements: StatusLine[] = [];
  const rejections: StatusLine[] = [];
  const otherStatuses: StatusLine[] = [];
  const fieldErrors: ClaimWarning[] = [];
  walk(raw, (item) => {
    const categoryCode = text(item.healthCareClaimStatusCategoryCode);
    if (categoryCode) {
      const line: StatusLine = {
        categoryCode,
        category: text(item.healthCareClaimStatusCategoryCodeValue),
        statusCode: text(item.statusCode),
        description: text(item.statusCodeValue),
      };
      if (categoryCode === 'A1' || categoryCode === 'A2') acknowledgements.push(line);
      else if (/^(A[3-8]|R)/.test(categoryCode)) rejections.push(line);
      else otherStatuses.push(line);
    }
    if (item.field || item.location) {
      const warning = {
        field: text(item.field),
        code: text(item.code),
        description: text(item.description || item.statusCodeValue),
        location: text(item.location),
      };
      if (warning.field || warning.description) fieldErrors.push(warning);
    }
  });
  return { acknowledgements, rejections, otherStatuses, fieldErrors };
}

export function parseClaimStatus(raw: unknown): ClaimStatusModel {
  const adjudication: ClaimStatusModel['adjudication'] = [];
  walk(raw, (item) => {
    const categoryCode = text(item.statusCategoryCode);
    if (!categoryCode) return;
    adjudication.push({
      categoryCode,
      category: text(item.statusCategoryCodeValue),
      statusCode: text(item.statusCode),
      description: text(item.statusCodeValue),
      payerClaimControlNumber: text(item.tradingPartnerClaimNumber),
      claimServiceDate: text(item.claimServiceDate),
      submittedAmount: text(item.submittedAmount),
      amountPaid: text(item.amountPaid),
      paidDate: text(item.paidDate),
      checkIssueDate: text(item.checkIssueDate),
      checkNumber: text(item.checkNumber),
    });
  });
  return { adjudication };
}

export function parse835(raw: unknown): RemittanceModel {
  let traceNumber = '';
  let paymentMethod = '';
  let totalPaidAmount = '';
  const adjustments: Adjustment[] = [];
  const remarkCodes: string[] = [];
  walk(raw, (item) => {
    if (!traceNumber) traceNumber = text(item.checkOrEFTTraceNumber);
    if (!paymentMethod) paymentMethod = text(item.paymentMethodCode);
    if (!totalPaidAmount) totalPaidAmount = text(item.totalActualProviderPaymentAmount);
    const remark = text(item.remarkCode);
    if (remark) remarkCodes.push(remark);
    const group = text(item.claimAdjustmentGroupCode);
    if (!group) return;
    for (let index = 1; index <= 6; index += 1) {
      const reasonCode = text(item[`adjustmentReasonCode${index}`]);
      const amount = text(item[`adjustmentAmount${index}`]);
      if (!reasonCode && !amount) continue;
      adjustments.push({
        group,
        groupValue: text(item.claimAdjustmentGroupCodeValue),
        reasonCode,
        amount,
      });
    }
  });
  return { traceNumber, paymentMethod, totalPaidAmount, adjustments, remarkCodes };
}

export function reportIds(raw: unknown): string[] {
  const reports = record(raw)?.reports;
  return Array.isArray(reports) ? reports.map(text).filter(Boolean) : [];
}

function toMoney(benefit: Record<string, unknown>): MoneyBenefit {
  const serviceTypes = texts(benefit.serviceTypes);
  return {
    name: text(benefit.name),
    coverageLevel: text(benefit.coverageLevel || benefit.coverageLevelCode),
    serviceTypes: serviceTypes.length ? serviceTypes : texts(benefit.serviceTypeCodes),
    amount: text(benefit.benefitAmount),
    percent: text(benefit.benefitPercent),
    timeQualifier: text(benefit.timeQualifier || benefit.timeQualifierCode),
    network: text(benefit.inPlanNetworkIndicator || benefit.inPlanNetworkIndicatorCode),
  };
}

function walk(node: unknown, visit: (record: Record<string, unknown>) => void): void {
  if (Array.isArray(node)) {
    node.forEach((item) => walk(item, visit));
    return;
  }
  const item = record(node);
  if (!item) return;
  visit(item);
  Object.values(item).forEach((value) => walk(value, visit));
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(record).filter((item): item is Record<string, unknown> => item !== null) : [];
}

function text(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

function texts(value: unknown): string[] {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : [];
}
