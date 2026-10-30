import type { ApiErrorBody } from '@smart-finance/shared-types';

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '/api/v1';

export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;
  /** Seconds from `Retry-After`, when the server sent a numeric value. */
  retryAfterSeconds: number | null;

  constructor(
    status: number,
    body: Partial<ApiErrorBody> | null,
    fallback: string,
    retryAfterSeconds: number | null = null,
  ) {
    const rawMessage = (body as { message?: unknown } | null)?.message;
    const message =
      typeof rawMessage === 'string'
        ? rawMessage
        : Array.isArray(rawMessage)
          ? rawMessage.join(', ')
          : fallback;
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = body?.code ?? 'UNKNOWN';
    this.details = body?.details;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const isFormData = init.body instanceof FormData;
  if (init.body && !isFormData && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
    credentials: 'include',
  });

  if (!response.ok) {
    let body: Partial<ApiErrorBody> | null = null;
    try {
      body = (await response.json()) as Partial<ApiErrorBody>;
    } catch {
      body = null;
    }
    const retryAfterHeader = response.headers.get('retry-after')?.trim() ?? '';
    const retryAfterSeconds = /^\d+$/.test(retryAfterHeader) ? Number(retryAfterHeader) : null;
    throw new ApiError(
      response.status,
      body,
      `Yêu cầu thất bại (${response.status})`,
      retryAfterSeconds,
    );
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const api = {
  get<T>(path: string): Promise<T> {
    return request<T>(path);
  },
  post<T>(path: string, body?: unknown): Promise<T> {
    return request<T>(path, {
      method: 'POST',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  },
  patch<T>(path: string, body?: unknown): Promise<T> {
    return request<T>(path, {
      method: 'PATCH',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  },
  delete<T>(path: string, body?: unknown): Promise<T> {
    return request<T>(path, {
      method: 'DELETE',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  },
  upload<T>(path: string, formData: FormData): Promise<T> {
    return request<T>(path, { method: 'POST', body: formData });
  },
};

/** Downloads a binary/text response with the session cookie attached. */
export async function downloadFile(path: string, fallbackName: string): Promise<void> {
  const response = await fetch(`${API_BASE}${path}`, { credentials: 'include' });
  if (!response.ok) {
    throw new ApiError(response.status, null, 'Không thể tải tệp');
  }
  const disposition = response.headers.get('content-disposition') ?? '';
  const match = /filename="?([^";]+)"?/i.exec(disposition);
  const fileName = match?.[1] ?? fallbackName;
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Đã có lỗi xảy ra. Vui lòng thử lại.';
}
