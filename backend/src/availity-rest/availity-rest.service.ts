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

const PLACEHOLDER_CLIENT_IDS = new Set(['', 'sandbox', 'your_client_id_here']);

@Injectable()
export class AvailityRestService implements OnModuleInit {
  private readonly logger = new Logger(AvailityRestService.name);
  private readonly httpClient: AxiosInstance;
  private accessToken: string | null = null;
  private tokenExpiry: number = 0;
  private pendingToken: Promise<string> | null = null;
  private readonly tokenBufferMs = 60000;
  private readonly retryConfig: RetryConfig = {
    maxRetries: 3,
    baseDelayMs: 1000,
    maxDelayMs: 10000,
    retryableStatuses: [502, 503, 504],
  };

  constructor(private readonly configService: ConfigService) {
    const baseUrl = this.trimTrailingSlash(
      this.configService.get<string>('AVAILITY_BASE_URL') ?? 'https://api.availity.com',
    );

    this.httpClient = axios.create({
      baseURL: baseUrl,
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
          config.headers = config.headers || {};
          config.headers.Authorization = `Bearer ${token}`;
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
          config.headers = config.headers || {};
          config.headers.Authorization = `Bearer ${token}`;
          return this.httpClient.request(config);
        }

        return Promise.reject(error);
      },
    );
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

  private trimTrailingSlash(value: string): string {
    return value.replace(/\/+$/, '');
  }

  async onModuleInit() {
    const clientId = this.configService.get<string>('AVAILITY_CLIENT_ID') ?? '';
    if (PLACEHOLDER_CLIENT_IDS.has(clientId)) {
      this.logger.warn(
        'Availity OAuth credentials are sandbox placeholders. A token will be requested on the first API call.',
      );
      return;
    }

    try {
      await this.getAuthToken();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown token error';
      this.logger.error(`Availity token prefetch failed. The next API call will retry. ${message}`);
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

  private async requestToken(): Promise<string> {
    const tokenUrl =
      this.configService.get<string>('AVAILITY_TOKEN_URL') ?? 'https://api.availity.com/availity/v1/token';
    const clientId = this.configService.get<string>('AVAILITY_CLIENT_ID') ?? '';
    const clientSecret = this.configService.get<string>('AVAILITY_CLIENT_SECRET') ?? '';
    const realm = this.configService.get<string>('AVAILITY_REALM') ?? '';
    const scope = this.configService.get<string>('AVAILITY_SCOPE') ?? '';

    if (!clientId || !clientSecret) {
      throw new HttpException(
        {
          statusCode: HttpStatus.UNAUTHORIZED,
          message: 'Availity OAuth credentials are not configured',
          error: 'Unauthorized',
        },
        HttpStatus.UNAUTHORIZED,
      );
    }

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

      if (!response.data?.access_token) {
        throw new HttpException(
          {
            statusCode: HttpStatus.BAD_GATEWAY,
            message: 'Availity token response did not include an access_token',
            error: 'Bad Gateway',
          },
          HttpStatus.BAD_GATEWAY,
        );
      }

      const expiresIn = response.data.expires_in || 300;
      this.accessToken = response.data.access_token;
      this.tokenExpiry = Date.now() + expiresIn * 1000;
      this.logger.log(`Obtained Availity access token. Expires in ${expiresIn}s`);
      return this.accessToken;
    } catch (error) {
      this.logger.error(`Failed to obtain Availity access token: ${this.errorSummary(error)}`);
      throw this.toHttpException(error, 'Availity authentication failed');
    }
  }

  private async getAuthHeaders(): Promise<Record<string, string>> {
    const token = await this.getAuthToken();
    return {
      Authorization: `Bearer ${token}`,
    };
  }

  async checkEligibility(query: CoverageInquiryDto): Promise<unknown> {
    const serviceType = query.serviceTypeCode || '30';
    const payload = this.omitEmpty({
      payerId: query.payerId,
      memberId: query.memberId,
      serviceType,
      asOfDate: query.asOfDate || new Date().toISOString().slice(0, 10),
      patientFirstName: query.patientFirstName,
      patientLastName: query.patientLastName,
      patientBirthDate: query.patientBirthDate,
      patientGender: query.patientGender,
      providerNpi: query.providerNpi,
      submitterId: this.configService.get<string>('AVAILITY_SUBMITTER_ID'),
    });

    return this.post('/availity/v1/coverages', payload);
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
    return this.execute(() => this.httpClient.get<T>(url, { ...config, headers }));
  }

  async post<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
    const headers = await this.getAuthHeaders();
    return this.execute(() => this.httpClient.post<T>(url, data, { ...config, headers }));
  }

  async put<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
    const headers = await this.getAuthHeaders();
    return this.execute(() => this.httpClient.put<T>(url, data, { ...config, headers }));
  }

  async delete<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
    const headers = await this.getAuthHeaders();
    return this.execute(() => this.httpClient.delete<T>(url, { ...config, headers }));
  }

  async postX12<T>(url: string, x12Data: string, config?: AxiosRequestConfig): Promise<T> {
    const headers = {
      ...(await this.getAuthHeaders()),
      'Content-Type': 'application/edi-x12',
      Accept: 'application/edi-x12',
    };
    return this.execute(() => this.httpClient.post<T>(url, x12Data, { ...config, headers }));
  }

  getToken(): string | null {
    return this.accessToken;
  }

  isTokenValid(): boolean {
    return this.accessToken !== null && Date.now() < this.tokenExpiry - this.tokenBufferMs;
  }

  private async execute<T>(request: () => Promise<{ data: T }>): Promise<T> {
    try {
      const response = await request();
      return response.data;
    } catch (error) {
      throw this.toHttpException(error, 'Availity request failed');
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

  private errorSummary(error: unknown): string {
    if (axios.isAxiosError(error)) {
      const data = error.response?.data;
      if (typeof data === 'string') {
        return data;
      }
      if (data && typeof data === 'object') {
        const body = data as { error_description?: string; message?: string; error?: string };
        return body.error_description || body.message || body.error || error.message;
      }
      return error.message;
    }
    return error instanceof Error ? error.message : 'Unknown error';
  }

  private toHttpException(error: unknown, fallbackMessage: string): HttpException {
    if (error instanceof HttpException) {
      return error;
    }

    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const httpStatus = status && status >= 400 && status < 600 ? status : HttpStatus.BAD_GATEWAY;
      const data = error.response?.data;
      let message = fallbackMessage;

      if (typeof data === 'string' && data.trim()) {
        message = data;
      } else if (data && typeof data === 'object') {
        const body = data as { error_description?: string; userMessage?: string; message?: string; error?: string };
        message = body.error_description || body.userMessage || body.message || body.error || error.message || fallbackMessage;
      } else if (error.message) {
        message = error.message;
      }

      return new HttpException(
        {
          statusCode: httpStatus,
          message,
          error: 'Availity request failed',
          details: data ?? null,
        },
        httpStatus,
      );
    }

    const message = error instanceof Error ? error.message : fallbackMessage;
    return new HttpException(
      {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message,
        error: 'Availity request failed',
      },
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}
