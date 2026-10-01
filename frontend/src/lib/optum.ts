import { ApiError, api } from './api';

export interface OptumCall {
  at: string;
  method: string;
  path: string;
  httpStatus: number;
  request?: unknown;
  data?: unknown;
}

export interface StepAudit<T> {
  step: string;
  ok: boolean;
  calls: OptumCall[];
  parsed: T | null;
}

export function optumPost<T>(path: string, body: unknown): Promise<StepAudit<T>> {
  return api<StepAudit<T>>(path, { method: 'POST', body: JSON.stringify(body) });
}

export function optumGet<T>(path: string): Promise<StepAudit<T>> {
  return api<StepAudit<T>>(path);
}

export function controlNumber(): string {
  return String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
}

// Dropdown fields keep their first option; every other text field starts empty.
export function blankForm<T extends object>(sample: T, keep: (keyof T)[]): T {
  return Object.fromEntries(
    Object.entries(sample).map(([key, value]) => [key, typeof value === 'string' && !keep.includes(key as keyof T) ? '' : value]),
  ) as T;
}

// Optum expects CCYYMMDD; <input type="date"> gives YYYY-MM-DD.
export function ymd(date: string): string {
  return date.replace(/-/g, '');
}

export function optumErrorText(error: unknown): string {
  if (!(error instanceof Error)) return 'Optum request failed';
  const body = error instanceof ApiError && error.body && typeof error.body === 'object' ? (error.body as Record<string, unknown>) : {};
  const status = error instanceof ApiError && error.status ? `HTTP ${error.status}` : '';
  const extra = [status, body.traceId ? `traceId ${body.traceId}` : '', body.applicationMode ? `mode ${body.applicationMode}` : '']
    .filter(Boolean)
    .join(' · ');
  return extra ? `${error.message}\n${extra}` : error.message;
}
