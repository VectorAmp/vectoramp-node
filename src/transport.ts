import { VectorAmpError } from './errors.js';
import type { RequestOptions, StreamEvent, StreamRequestOptions, Transport } from './types.js';
import { appendQuery, joinUrl, mergeHeaders } from './utils.js';

/** Options for the default REST transport. */
export interface RestTransportOptions {
  /** API key sent as `X-API-Key`. */
  apiKey?: string;
  /** API origin, for example `https://api.vectoramp.com`. */
  baseUrl: string;
  /** API prefix mounted under `baseUrl`, for example `/api/v1`. */
  apiPrefix: string;
  /** Custom fetch implementation. Defaults to `globalThis.fetch`. */
  fetch?: typeof fetch;
  /** Headers included with every request. */
  headers?: HeadersInit;
}

/** Default fetch-based REST transport used by {@link VectorAmpClient}. */
export class RestTransport implements Transport {
  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly apiPrefix: string;
  private readonly fetchImpl: typeof fetch;
  private readonly headers?: HeadersInit;

  /**
   * Create a REST transport.
   *
   * @param options - Transport configuration.
   */
  constructor(options: RestTransportOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl;
    this.apiPrefix = options.apiPrefix;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.headers = options.headers;

    if (!this.fetchImpl) {
      throw new Error('No fetch implementation available. Use Node.js 18+ or pass VectorAmp({ fetch }).');
    }
  }

  /**
   * Send a REST request and parse the response body.
   *
   * @param method - HTTP method.
   * @param path - API path under `apiPrefix`.
   * @param options - Request options.
   * @returns Parsed response body.
   */
  async request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
    const response = await this.fetchRaw(method, path, options);
    return this.parseResponse<T>(response);
  }

  /**
   * Send a streaming REST request and parse SSE events.
   *
   * @param method - HTTP method.
   * @param path - API path under `apiPrefix`.
   * @param options - Streaming request options.
   * @returns Async iterable of stream events.
   */
  async *stream(method: string, path: string, options: StreamRequestOptions = {}): AsyncIterable<StreamEvent> {
    const response = await this.fetchRaw(method, path, {
      ...options,
      headers: mergeHeaders({ Accept: options.accept ?? 'text/event-stream' }, options.headers)
    });

    if (!response.body) return;

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split(/\r?\n\r?\n/);
        buffer = parts.pop() ?? '';
        for (const part of parts) {
          const event = parseSseEvent(part);
          if (event) yield event;
        }
      }

      buffer += decoder.decode();
      const event = parseSseEvent(buffer);
      if (event) yield event;
    } finally {
      reader.releaseLock();
    }
  }

  private async fetchRaw(method: string, path: string, options: RequestOptions): Promise<Response> {
    const url = appendQuery(joinUrl(this.baseUrl, this.apiPrefix, path), options.query);
    const headers = mergeHeaders(
      { Accept: 'application/json' },
      this.headers,
      this.apiKey ? { 'X-API-Key': this.apiKey } : undefined,
      options.body === undefined ? undefined : { 'Content-Type': 'application/json' },
      options.headers
    );

    const response = await this.fetchImpl(url, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal
    });

    if (!response.ok) {
      const body = await parseBody(response);
      const message = errorMessage(body) ?? `VectorAmp API request failed: ${response.status} ${response.statusText}`;
      throw new VectorAmpError(message, { status: response.status, statusText: response.statusText, url, body });
    }

    return response;
  }

  private async parseResponse<T>(response: Response): Promise<T> {
    if (response.status === 204) return undefined as T;
    return parseBody(response) as Promise<T>;
  }
}

async function parseBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) return response.json();
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function errorMessage(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const object = body as Record<string, unknown>;
  return (object.message ?? object.error ?? object.detail) as string | undefined;
}

function parseSseEvent(chunk: string): StreamEvent | undefined {
  if (!chunk.trim()) return undefined;

  const data: string[] = [];
  const event: Partial<StreamEvent> = {};

  for (const line of chunk.split(/\r?\n/)) {
    if (!line || line.startsWith(':')) continue;
    const separator = line.indexOf(':');
    const field = separator === -1 ? line : line.slice(0, separator);
    const rawValue = separator === -1 ? '' : line.slice(separator + 1).replace(/^ /, '');

    if (field === 'data') data.push(rawValue);
    if (field === 'event') event.event = rawValue;
    if (field === 'id') event.id = rawValue;
    if (field === 'retry') event.retry = Number(rawValue);
  }

  const payload = data.join('\n');
  if (!payload && !event.event && !event.id && event.retry === undefined) return undefined;
  if (payload === '[DONE]') return { ...event, event: event.event ?? 'done', data: '[DONE]' };

  return {
    ...event,
    data: parseSseData(payload)
  };
}

function parseSseData(payload: string): unknown {
  if (!payload) return undefined;
  try {
    return JSON.parse(payload);
  } catch {
    return payload;
  }
}
