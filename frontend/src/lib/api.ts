export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(message: string, options?: { cause?: unknown; status?: number; body?: unknown }) {
    super(message);
    this.name = 'ApiError';
    this.status = options?.status ?? 0;
    this.body = options?.body ?? null;
    if (options && 'cause' in options) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

export interface CoverageInquiryPayload {
  payerId: string;
  memberId: string;
  patientFirstName: string;
  patientLastName: string;
  patientBirthDate: string;
  patientGender?: 'M' | 'F';
  providerNpi: string;
  serviceTypeCode?: string;
  procedureCode?: string;
  serviceDate?: string;
}

export function postCoverageInquiry(payload: CoverageInquiryPayload): Promise<unknown> {
  return api<unknown>('/api/availity/eligibility', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method || 'GET').toUpperCase();
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
    });
  } catch (err) {
    throw new ApiError(`${method} ${path} failed`, { cause: err, status: 0 });
  }

  const text = await response.text();
  let data: unknown;
  if (text) {
    try {
      data = JSON.parse(text) as unknown;
    } catch (err) {
      throw new ApiError(`${method} ${path} failed`, { cause: err, status: response.status, body: text });
    }
  }

  if (!response.ok) {
    const record = data && typeof data === 'object' ? (data as { error?: unknown; message?: unknown }) : undefined;
    const fromError = typeof record?.error === 'string' ? record.error : '';
    const fromMessage = Array.isArray(record?.message)
      ? record.message.join('\n')
      : typeof record?.message === 'string'
        ? record.message
        : '';
    throw new ApiError(fromError || fromMessage || `${method} ${path} failed`, {
      status: response.status,
      body: data,
    });
  }

  if (data === undefined) {
    throw new ApiError(`${method} ${path} failed`, { status: response.status, body: text });
  }

  return data as T;
}
