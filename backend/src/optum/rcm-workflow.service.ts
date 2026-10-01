import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OptumApiClient, OptumResponse } from './optum-api.client';
import { OptumAuthService } from './optum-auth.service';
import {
  ClaimStatusModel,
  ClaimSubmissionModel,
  EligibilityModel,
  OptumErrorBody,
  OptumRequestError,
  RemittanceModel,
  Report277Model,
  claimStatusRequest,
  eligibilityRequest,
  parse277,
  parse835,
  parseClaimStatus,
  parseClaimSubmission,
  parseEligibility,
  professionalClaimRequest,
  reportIds,
} from './optum.contracts';

export interface StepAudit<T> {
  step: string;
  ok: boolean;
  calls: OptumResponse<unknown>[];
  parsed: T | null;
  error?: OptumErrorBody;
}

@Injectable()
export class RcmWorkflowService {
  private readonly logger = new Logger(RcmWorkflowService.name);

  constructor(
    private readonly auth: OptumAuthService,
    private readonly client: OptumApiClient,
    private readonly configService: ConfigService,
  ) {}

  async authenticate(): Promise<StepAudit<{ tokenType: string; expiresAt: string }>> {
    try {
      await this.auth.getAccessToken();
      const call = this.auth.getLastCall();
      return this.success('oauth', call ? [call] : [], this.auth.tokenSummary());
    } catch (error) {
      throw this.tag('oauth', error);
    }
  }

  async checkEligibility(body?: Record<string, unknown>): Promise<StepAudit<EligibilityModel>> {
    const request = this.payload(body, eligibilityRequest(this.configService.get<string>('OPTUM_TRADING_PARTNER_ID') || '87726'));
    const response = await this.invoke<Record<string, unknown>>('eligibility', () =>
      this.client.post('/medicalnetwork/eligibility/v3', request),
    );
    return this.success('eligibility', [response], parseEligibility(response.data));
  }

  submitProfessionalClaim(body?: Record<string, unknown>): Promise<StepAudit<ClaimSubmissionModel>> {
    return this.professionalClaim('submission', body);
  }

  validateProfessionalClaim(body?: Record<string, unknown>): Promise<StepAudit<ClaimSubmissionModel>> {
    return this.professionalClaim('validation', body);
  }

  async fetch277(reportId?: string): Promise<StepAudit<Report277Model>> {
    const filename = reportId || this.configService.get<string>('OPTUM_277_REPORT_ID') || 'X3000000.XX';
    const response = await this.invoke<unknown>('277', () =>
      this.client.get(`/medicalnetwork/reports/v2/${encodeURIComponent(filename)}/277`),
    );
    return this.success('277', [response], parse277(response.data));
  }

  async listReports(): Promise<StepAudit<{ reports: string[] }>> {
    const response = await this.invoke<unknown>('reports', () => this.client.get('/medicalnetwork/reports/v2'));
    return this.success('reports', [response], { reports: reportIds(response.data) });
  }

  async queryClaimStatus(body?: Record<string, unknown>): Promise<StepAudit<ClaimStatusModel>> {
    const request = this.payload(body, claimStatusRequest());
    const response = await this.invoke<unknown>('claim-status', () => this.client.post('/medicalnetwork/claimstatus/v2', request));
    return this.success('claim-status', [response], parseClaimStatus(response.data));
  }

  async fetch835(reportId?: string): Promise<StepAudit<RemittanceModel>> {
    const filename = reportId || this.configService.get<string>('OPTUM_835_REPORT_ID') || 'R5000000.WA';
    const response = await this.invoke<unknown>('835', () =>
      this.client.get(`/medicalnetwork/reports/v2/${encodeURIComponent(filename)}/835`),
    );
    return this.success('835', [response], parse835(response.data));
  }

  private professionalClaim(action: 'validation' | 'submission', body?: Record<string, unknown>): Promise<StepAudit<ClaimSubmissionModel>> {
    const request = this.payload(body, professionalClaimRequest());
    return this.invoke<Record<string, unknown>>('professional-claim', () =>
      this.client.post(`/medicalnetwork/professionalclaims/v3/${action}`, request),
    ).then((response) => this.success(action === 'validation' ? 'claim-validation' : 'professional-claim', [response], parseClaimSubmission(response.data)));
  }

  private success<T>(step: string, calls: OptumResponse<unknown>[], parsed: T): StepAudit<T> {
    for (const call of calls) this.logger.log(`${step} ${call.method} ${call.path} ${call.httpStatus} ${call.at}`);
    return { step, ok: true, calls, parsed };
  }

  private async invoke<T>(step: string, request: () => Promise<OptumResponse<T>>): Promise<OptumResponse<T>> {
    try {
      return await request();
    } catch (error) {
      throw this.tag(step, error);
    }
  }

  private tag(step: string, error: unknown): unknown {
    if (error instanceof OptumRequestError) error.step = step;
    return error;
  }

  private payload(body: Record<string, unknown> | undefined, fallback: Record<string, unknown>): Record<string, unknown> {
    return body && Object.keys(body).length > 0 ? body : fallback;
  }
}
