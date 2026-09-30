export class ApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
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
  } catch {
    throw new ApiError('Cannot reach the Availity API. Start the Nest server on port 3000.');
  }

  const text = await response.text();
  let data: { message?: string | string[] } | null = null;
  if (text) {
    try {
      data = JSON.parse(text) as { message?: string | string[] };
    } catch {
      data = { message: text };
    }
  }

  if (!response.ok) {
    const message = data?.message;
    const rendered = Array.isArray(message) ? message.join('\n') : message || `Request failed (${response.status})`;
    throw new ApiError(rendered);
  }

  return data as T;
}
