import { HttpException, HttpStatus, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError, AxiosInstance, AxiosRequestConfig, InternalAxiosRequestConfig } from 'axios';
import { ClaimStatusQueryDto } from './dto/claim-status-query.dto';
import { CoverageInquiryDto } from './dto/coverage-inquiry.dto';

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
}

export interface AvailityApiError {
  error: string;
  error_description?: string;
  statusCode: number;
}

interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  retryableStatuses: number[];
}

interface RetryableRequestConfig extends InternalAxiosRequestConfig {
  _retry?: boolean;
  _retryCount?: number;
}

const TOKEN_REFRESH_BUFFER_MS = 60_000;

export class AvailityRestError extends Error {
  readonly op: string;
  readonly upstream: string;
  readonly statusCode: number;

  constructor(op: string, err: unknown) {
    const described = describeUpstream(err);
    super(described.message);
    this.name = 'AvailityRestError';
    this.op = op;
    this.upstream = described.upstream;
    this.statusCode = described.statusCode;
  }
}

export interface AvailityCoverageResponse {
  id?: string;
  statusCode?: number | string;
  status?: string;
  payerId?: string;
  payerName?: string;
  memberId?: string;
  serviceType?: string;
  procedureCode?: string;
  plans?: unknown[];
  coverages?: AvailityCoverageResponse[];
  validationMessages?: unknown[];
}

@Injectable()
export class AvailityRestService implements OnModuleInit {
  private readonly logger = new Logger(AvailityRestService.name);
  private readonly httpClient: AxiosInstance;
  private accessToken: string | null = null;
  private tokenExpiry = 0;
  private pendingToken: Promise<string> | null = null;
  private readonly tokenBufferMs = TOKEN_REFRESH_BUFFER_MS;
  private readonly retryConfig: RetryConfig = {
    maxRetries: 3,
    baseDelayMs: 1000,
    maxDelayMs: 10000,
    retryableStatuses: [502, 503, 504],
  };

  constructor(private readonly configService: ConfigService) {
    const baseUrl = this.requiredConfig('AVAILITY_BASE_URL');
    this.httpClient = axios.create({
      baseURL: baseUrl.replace(/\/+$/, ''),
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    });

    this.httpClient.interceptors.response.use(
      (response) => response,
      async (error: AxiosError) => {
        const config = error.config as RetryableRequestConfig | undefined;
        const status = error.response?.status;

        if (status === 401 && config && !config._retry) {
          config._retry = true;
          const token = await this.getAuthToken(true);
          this.assignAuthorization(config, token);
          return this.httpClient.request(config);
        }

        if (this.isRetryableError(status) && config && config._retryCount == null) {
          config._retryCount = 0;
        }

        if (this.isRetryableError(status) && config && (config._retryCount ?? 0) < this.retryConfig.maxRetries) {
          config._retryCount = (config._retryCount ?? 0) + 1;
          const delay = this.calculateBackoff(config._retryCount);
          this.logger.warn(
            `Request failed with status ${status}, retrying in ${delay}ms (attempt ${config._retryCount}/${this.retryConfig.maxRetries})`,
          );
          await this.sleep(delay);
          const token = await this.getAuthToken();
          this.assignAuthorization(config, token);
          return this.httpClient.request(config);
        }

        return Promise.reject(error);
      },
    );
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.getAuthToken();
    } catch (error) {
      if (error instanceof AvailityRestError) {
        throw error;
      }
      throw new AvailityRestError('getAuthToken', error);
    }
  }

  async getAuthToken(forceRefresh = false): Promise<string> {
    if (!forceRefresh && this.isTokenValid() && this.accessToken) {
      return this.accessToken;
    }

    if (!forceRefresh && this.pendingToken) {
      return this.pendingToken;
    }

    const request = this.requestToken();
    this.pendingToken = request;
    try {
      return await request;
    } finally {
      if (this.pendingToken === request) {
        this.pendingToken = null;
      }
    }
  }

  async checkEligibility(query: CoverageInquiryDto): Promise<AvailityCoverageResponse> {
    try {
      const created = await this.post<AvailityCoverageResponse>('/availity/v1/coverages', this.coverageForm(query), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
      });
      return await this.pollCoverage(this.unwrapCoverage(created));
    } catch (error) {
      if (error instanceof AvailityRestError || error instanceof HttpException) {
        throw error;
      }
      throw new AvailityRestError('checkEligibility', error);
    }
  }

  async submitClaimStatus(query: ClaimStatusQueryDto): Promise<unknown> {
    const payload = this.omitEmpty({
      payerId: query.payerId,
      providerNpi: query.providerNpi,
      memberId: query.memberId,
      patientFirstName: query.patientFirstName,
      patientLastName: query.patientLastName,
      patientBirthDate: query.patientBirthDate,
      patientAccountNumber: query.patientControlNumber,
      submitterId: this.configService.get<string>('AVAILITY_SUBMITTER_ID'),
      fromDate: query.serviceDate,
      toDate: query.serviceDate,
    });

    return this.post('/v1/claim-statuses', payload);
  }

  async getClaimStatus(id: string): Promise<unknown> {
    const trimmed = id?.trim();
    if (!trimmed) {
      throw new HttpException(
        {
          statusCode: HttpStatus.BAD_REQUEST,
          message: 'Claim status id is required',
          error: 'Bad Request',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    return this.get(`/v1/claim-statuses/${encodeURIComponent(trimmed)}`);
  }

  async get<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
    const headers = await this.getAuthHeaders();
    return this.execute(`GET ${url}`, () => this.httpClient.get<T>(url, { ...config, headers }));
  }

  async post<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
    const headers = {
      ...(config?.headers && typeof config.headers === 'object' ? config.headers : {}),
      ...(await this.getAuthHeaders()),
    };
    return this.execute(`POST ${url}`, () => this.httpClient.post<T>(url, data, { ...config, headers }));
  }

  async put<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
    const headers = await this.getAuthHeaders();
    return this.execute(`PUT ${url}`, () => this.httpClient.put<T>(url, data, { ...config, headers }));
  }

  async delete<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
    const headers = await this.getAuthHeaders();
    return this.execute(`DELETE ${url}`, () => this.httpClient.delete<T>(url, { ...config, headers }));
  }

  async postX12<T>(url: string, x12Data: string, config?: AxiosRequestConfig): Promise<T> {
    const headers = {
      ...(await this.getAuthHeaders()),
      'Content-Type': 'application/edi-x12',
      Accept: 'application/edi-x12',
    };
    return this.execute(`POST ${url}`, () => this.httpClient.post<T>(url, x12Data, { ...config, headers }));
  }

  getToken(): string | null {
    return this.accessToken;
  }

  isTokenValid(): boolean {
    return this.accessToken !== null && Date.now() < this.tokenExpiry - this.tokenBufferMs;
  }

  private async requestToken(): Promise<string> {
    const tokenUrl = this.requiredConfig('AVAILITY_TOKEN_URL');
    const clientId = this.requiredConfig('AVAILITY_CLIENT_ID');
    const clientSecret = this.requiredConfig('AVAILITY_CLIENT_SECRET');
    const realm = this.configService.get<string>('AVAILITY_REALM')?.trim();
    const scope = this.configService.get<string>('AVAILITY_SCOPE')?.trim();

    const params = new URLSearchParams();
    params.append('grant_type', 'client_credentials');
    params.append('client_id', clientId);
    params.append('client_secret', clientSecret);
    if (realm) {
      params.append('realm', realm);
    }
    if (scope) {
      params.append('scope', scope);
    }

    try {
      const response = await axios.post<TokenResponse>(tokenUrl, params, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        timeout: 30000,
      });

      const accessToken = response.data?.access_token;
      const expiresIn = response.data?.expires_in;
      if (!accessToken) {
        throw new AvailityRestError('getAuthToken', new Error('Availity token response did not include an access_token'));
      }
      if (typeof expiresIn !== 'number' || expiresIn <= 0) {
        throw new AvailityRestError('getAuthToken', new Error('Availity token response did not include a positive expires_in'));
      }

      this.accessToken = accessToken;
      this.tokenExpiry = Date.now() + expiresIn * 1000;
      this.logger.log(`Obtained Availity access token. Expires in ${expiresIn}s`);
      return this.accessToken;
    } catch (error) {
      if (error instanceof AvailityRestError) {
        throw error;
      }
      this.logger.error(`Failed to obtain Availity access token: ${error instanceof Error ? error.message : 'unknown'}`);
      throw new AvailityRestError('getAuthToken', error);
    }
  }

  private async getAuthHeaders(): Promise<Record<string, string>> {
    const token = await this.getAuthToken();
    return {
      Authorization: `Bearer ${token}`,
    };
  }

  private coverageForm(query: CoverageInquiryDto): URLSearchParams {
    const params = new URLSearchParams();
    params.append('payerId', query.payerId);
    const submitterId = this.configService.get<string>('AVAILITY_SUBMITTER_ID')?.trim();
    if (submitterId) {
      params.append('submitterId', submitterId);
    }
    params.append('providerNpi', query.providerNpi);
    params.append('memberId', query.memberId);
    params.append('patientFirstName', query.patientFirstName);
    params.append('patientLastName', query.patientLastName);
    params.append('patientBirthDate', query.patientBirthDate);
    if (query.patientGender === 'M' || query.patientGender === 'F') {
      params.append('patientGender', query.patientGender);
    }
    const serviceType = query.serviceTypeCode?.trim();
    if (!serviceType) {
      throw new HttpException(
        {
          statusCode: HttpStatus.BAD_REQUEST,
          message: 'serviceTypeCode is required',
          error: 'Bad Request',
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    params.append('serviceType[]', serviceType);
    const procedureCode = query.procedureCode?.trim();
    if (procedureCode) {
      params.append('procedureCode', procedureCode);
    }
    const serviceDate = query.serviceDate?.trim();
    if (serviceDate) {
      params.append('asOfDate', serviceDate);
    }
    return params;
  }

  private unwrapCoverage(payload: AvailityCoverageResponse): AvailityCoverageResponse {
    const hasIdentity = payload.statusCode !== undefined || (typeof payload.id === 'string' && payload.id.trim().length > 0);
    if (hasIdentity || !Array.isArray(payload.coverages) || payload.coverages.length === 0) {
      return payload;
    }
    return payload.coverages[0];
  }

  // 0 is in progress. 4 is complete and 3 is complete with a partial payer response. 19 and the communication codes are terminal errors.
  private async pollCoverage(created: AvailityCoverageResponse): Promise<AvailityCoverageResponse> {
    const id = typeof created.id === 'string' ? created.id.trim() : '';
    if (!id || !this.isInProgress(created.statusCode)) {
      return created;
    }

    const attempts = this.coveragePollAttempts();
    const intervalMs = this.coveragePollIntervalMs();
    this.logger.log(`Coverage ${id} is in progress. Polling up to ${attempts} times every ${intervalMs}ms`);
    let latest: AvailityCoverageResponse = created;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      await this.sleep(intervalMs);
      latest = await this.get<AvailityCoverageResponse>(`/availity/v1/coverages/${encodeURIComponent(id)}`);
      if (latest.statusCode === undefined || latest.statusCode === null) {
        throw new AvailityRestError('pollCoverage', new Error(`Coverage ${id} response did not include statusCode`));
      }
      if (this.isTerminalCoverage(latest.statusCode)) {
        return latest;
      }
    }

    throw new AvailityRestError('pollCoverage', new Error(`Coverage ${id} did not reach a terminal statusCode`));
  }

  private coveragePollAttempts(): number {
    const configured = Number(this.configService.get('AVAILITY_COVERAGE_POLL_ATTEMPTS'));
    if (!Number.isFinite(configured) || configured < 1) {
      throw new AvailityRestError('pollCoverage', new Error('AVAILITY_COVERAGE_POLL_ATTEMPTS must be an integer >= 1'));
    }
    return configured;
  }

  private coveragePollIntervalMs(): number {
    const configured = Number(this.configService.get('AVAILITY_COVERAGE_POLL_INTERVAL_MS'));
    if (!Number.isFinite(configured) || configured < 0) {
      throw new AvailityRestError('pollCoverage', new Error('AVAILITY_COVERAGE_POLL_INTERVAL_MS must be an integer >= 0'));
    }
    return configured;
  }

  private isInProgress(statusCode: unknown): boolean {
    return statusCode === 0 || statusCode === '0';
  }

  private isTerminalCoverage(statusCode: unknown): boolean {
    const code = typeof statusCode === 'number' || typeof statusCode === 'string' ? String(statusCode) : '';
    return code === '3' || code === '4' || code === '19' || code === '7' || code === '13' || code === '14' || code === '15';
  }

  private requiredConfig(key: string): string {
    const value = this.configService.get<string>(key)?.trim();
    if (!value) {
      throw new AvailityRestError('config', new Error(`${key} is required`));
    }
    return value;
  }

  private assignAuthorization(config: RetryableRequestConfig, token: string): void {
    if (!config.headers) {
      config.headers = {} as RetryableRequestConfig['headers'];
    }
    config.headers.Authorization = `Bearer ${token}`;
  }

  private isRetryableError(status: number | undefined): boolean {
    return status !== undefined && this.retryConfig.retryableStatuses.includes(status);
  }

  private calculateBackoff(attempt: number): number {
    const delay = this.retryConfig.baseDelayMs * Math.pow(2, attempt - 1);
    const jitter = Math.random() * 0.3 * delay;
    return Math.min(delay + jitter, this.retryConfig.maxDelayMs);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async execute<T>(op: string, request: () => Promise<{ data: T }>): Promise<T> {
    try {
      const response = await request();
      if (response.data === undefined || response.data === null) {
        throw new AvailityRestError(op, new Error('Availity response body was empty'));
      }
      return response.data;
    } catch (error) {
      if (error instanceof AvailityRestError) {
        throw error;
      }
      throw new AvailityRestError(op, error);
    }
  }

  private omitEmpty<T extends Record<string, unknown>>(input: T): Partial<T> {
    return Object.fromEntries(
      Object.entries(input).filter(([, value]) => {
        if (value === undefined || value === null || value === '') {
          return false;
        }
        if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) {
          return false;
        }
        return true;
      }),
    ) as Partial<T>;
  }
}

function describeUpstream(err: unknown): { message: string; upstream: string; statusCode: number } {
  if (err instanceof AvailityRestError) {
    return { message: err.message, upstream: err.upstream, statusCode: err.statusCode };
  }
  if (axios.isAxiosError(err)) {
    const status = err.response?.status;
    const statusCode = status && status >= 400 && status < 600 ? status : HttpStatus.BAD_GATEWAY;
    const data = err.response?.data;
    let upstream = err.message;
    if (typeof data === 'string' && data.trim()) {
      upstream = data;
    } else if (data && typeof data === 'object') {
      const body = data as { error_description?: string; userMessage?: string; message?: string; error?: string };
      const text = [body.error_description, body.userMessage, body.message, body.error].find(
        (part) => typeof part === 'string' && part.trim().length > 0,
      );
      if (text) {
        upstream = text;
      }
    }
    return { message: upstream, upstream, statusCode };
  }
  if (err instanceof Error && err.message) {
    return { message: err.message, upstream: err.message, statusCode: HttpStatus.BAD_GATEWAY };
  }
  return {
    message: 'Availity request failed',
    upstream: 'Availity request failed',
    statusCode: HttpStatus.BAD_GATEWAY,
  };
}
