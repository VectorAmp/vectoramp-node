import type { Page } from './types.js';

export function joinUrl(baseUrl: string, apiPrefix: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  const prefix = apiPrefix ? `/${apiPrefix.replace(/^\/+|\/+$/g, '')}` : '';
  const cleanPath = `/${path.replace(/^\/+/, '')}`;
  return `${base}${prefix}${cleanPath}`;
}

export function appendQuery(url: string, query?: Record<string, string | number | boolean | undefined | null>): string {
  if (!query) return url;
  const out = new URL(url);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) out.searchParams.set(key, String(value));
  }
  return out.toString();
}

export function toSnakeCasePayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toSnakeCasePayload);
  if (!value || typeof value !== 'object' || value instanceof Date || value instanceof Blob) return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, nested]) => [camelToSnake(key), toSnakeCasePayload(nested)])
  );
}

export function camelToSnake(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

export function normalizePage<T>(payload: unknown, params?: { limit?: number; offset?: number }, collectionKey?: string): Page<T> {
  if (Array.isArray(payload)) {
    return { data: payload as T[], limit: params?.limit, offset: params?.offset };
  }

  const object = (payload ?? {}) as Record<string, unknown>;
  const keyedData = collectionKey ? object[collectionKey] : undefined;
  const data = (keyedData ?? object.data ?? object.items ?? object.datasets ?? object.results ?? []) as T[];
  const nextOffset = object.nextOffset ?? object.next_offset;
  const nextCursor = object.nextCursor ?? object.next_cursor;
  const hasMore = object.hasMore ?? object.has_more;

  return {
    data,
    limit: (object.limit as number | undefined) ?? params?.limit,
    offset: (object.offset as number | undefined) ?? params?.offset,
    total: object.total as number | undefined,
    nextOffset: (nextOffset as number | null | undefined) ?? undefined,
    nextCursor: (nextCursor as string | null | undefined) ?? undefined,
    hasMore: hasMore as boolean | undefined
  };
}

export function mergeHeaders(...headers: Array<HeadersInit | undefined>): Headers {
  const merged = new Headers();
  for (const headerBag of headers) {
    if (!headerBag) continue;
    new Headers(headerBag).forEach((value, key) => merged.set(key, value));
  }
  return merged;
}
