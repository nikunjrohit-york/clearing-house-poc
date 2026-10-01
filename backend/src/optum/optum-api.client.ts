import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance, Method } from 'axios';
import { OptumAuthService } from './optum-auth.service';
import { OptumCall, OptumRequestError } from './optum.contracts';

export interface OptumResponse<T> extends OptumCall {
  data: T;
}

@Injectable()
export class OptumApiClient {
  private readonly http: AxiosInstance;

  constructor(
    private readonly auth: OptumAuthService,
    configService: ConfigService,
  ) {
    const baseURL = (configService.get<string>('OPTUM_BASE_URL') ?? 'https://sandbox-apigw.optum.com').replace(/\/+$/, '');
    this.http = axios.create({
      baseURL,
      timeout: 30000,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    });
  }

  get<T>(path: string): Promise<OptumResponse<T>> {
    return this.send<T>('GET', path);
  }

  post<T>(path: string, body?: unknown): Promise<OptumResponse<T>> {
    return this.send<T>('POST', path, body);
  }

  private async send<T>(method: 'GET' | 'POST', path: string, body?: unknown, refreshed = false): Promise<OptumResponse<T>> {
    const token = await this.auth.getAccessToken(refreshed);
    const at = new Date().toISOString();
    try {
      const response = await this.http.request<T>({
        method: method as Method,
        url: path,
        data: body,
        headers: { Authorization: `Bearer ${token}` },
      });
      return { at, method, path, httpStatus: response.status, request: body, data: response.data };
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 401 && !refreshed) {
        return this.send(method, path, body, true);
      }
      const httpStatus = axios.isAxiosError(error) ? error.response?.status ?? 502 : 502;
      const data = axios.isAxiosError(error) ? (error.response?.data ?? { error: 'network_error', description: error.message }) : { error: 'network_error', description: 'Optum request failed' };
      throw new OptumRequestError({ at, method, path, httpStatus, request: body, data });
    }
  }
}
