import { apiErrorSchema } from '@vlp/shared';
import type { z } from 'zod';

const BASE_URL = import.meta.env.VITE_API_URL ?? '';

export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

/** Typed fetch: every response is validated against a shared Zod schema. */
export async function apiFetch<T extends z.ZodType>(
  path: string,
  schema: T,
  init?: RequestInit,
): Promise<z.infer<T>> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  const json: unknown = await res.json().catch(() => null);

  if (!res.ok) {
    const parsed = apiErrorSchema.safeParse(json);
    throw new ApiRequestError(
      res.status,
      parsed.success ? parsed.data.error.code : 'UNKNOWN',
      parsed.success ? parsed.data.error.message : res.statusText,
    );
  }
  return schema.parse(json);
}
