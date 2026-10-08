import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { OptumCall, OptumRequestError, readOptumError } from './optum.contracts';

interface TokenResponse {
  access_token?: string;
  expires_in?: number | string;
  token_type?: string;
}

@Injectable()
export class OptumAuthService {
  private readonly logger = new Logger(OptumAuthService.name);
  private accessToken: string | null = null;
  private tokenExpiry = 0;
  private pending: Promise<string> | null = null;
  private lastCall: OptumCall | null = null;
  private readonly refreshBufferMs = 60_000;

  constructor(private readonly configService: ConfigService) {}

  async getAccessToken(forceRefresh = false): Promise<string> {
    if (!forceRefresh && this.accessToken && Date.now() < this.tokenExpiry - this.refreshBufferMs) {
      return this.accessToken;
    }
    if (!forceRefresh && this.pending) return this.pending;

    const request = this.requestToken();
    this.pending = request;
    try {
      return await request;
    } finally {
      if (this.pending === request) this.pending = null;
    }
  }

  tokenSummary(): { tokenType: string; expiresAt: string } {
    return {
      tokenType: 'Bearer',
      expiresAt: this.tokenExpiry ? new Date(this.tokenExpiry).toISOString() : '',
    };
  }

  getLastCall(): OptumCall | null {
    return this.lastCall;
  }

  private async requestToken(): Promise<string> {
    const clientId = this.configService.get<string>('OPTUM_CLIENT_ID') ?? '';
    const clientSecret = this.configService.get<string>('OPTUM_CLIENT_SECRET') ?? '';
    const tokenUrl = this.configService.get<string>('OPTUM_TOKEN_URL')?.trim();
    if (!tokenUrl) {
      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'OPTUM_TOKEN_URL is required',
          error: 'Configuration',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
    if (!clientId || !clientSecret) {
      throw new HttpException(
        {
          statusCode: HttpStatus.UNAUTHORIZED,
          message: 'Optum OAuth credentials are not configured',
          error: 'Unauthorized',
          description: 'Set OPTUM_CLIENT_ID and OPTUM_CLIENT_SECRET',
          traceId: '',
          applicationMode: '',
        },
        HttpStatus.UNAUTHORIZED,
      );
    }

    const at = new Date().toISOString();
    const request = { client_id: '***', client_secret: '***', grant_type: 'client_credentials' };
    try {
      const response = await axios.post<TokenResponse>(
        tokenUrl,
        { client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials' },
        { headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, timeout: 30000 },
      );
      const accessToken = response.data?.access_token;
      if (!accessToken) {
        throw new OptumRequestError({
          at,
          method: 'POST',
          path: tokenUrl,
          httpStatus: HttpStatus.BAD_GATEWAY,
          request,
          data: response.data,
        });
      }
      const expiresIn = Number(response.data.expires_in) || 300;
      this.accessToken = accessToken;
      this.tokenExpiry = Date.now() + expiresIn * 1000;
      this.lastCall = {
        at,
        method: 'POST',
        path: tokenUrl,
        httpStatus: response.status,
        request,
        data: { token_type: response.data.token_type || 'Bearer', expires_in: expiresIn },
      };
      this.logger.log(`Obtained Optum access token. Expires in ${expiresIn}s`);
      return accessToken;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      const httpStatus = axios.isAxiosError(error) ? error.response?.status ?? HttpStatus.BAD_GATEWAY : HttpStatus.BAD_GATEWAY;
      const data = axios.isAxiosError(error) ? error.response?.data ?? { error: 'network_error', description: error.message } : { error: 'network_error', description: 'Optum authentication failed' };
      const optum = readOptumError(data, httpStatus);
      this.logger.error(`Optum token request failed: ${optum.error || optum.description || httpStatus}`);
      throw new OptumRequestError({ at, method: 'POST', path: tokenUrl, httpStatus, request, data });
    }
  }
}
