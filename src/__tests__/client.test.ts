import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VectorAmp, VectorAmpError, type Transport } from '../index.js';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...(init.headers as Record<string, string> | undefined) }
  });
}

describe('VectorAmp client', () => {
  afterEach(() => vi.restoreAllMocks());

  it('uses the default API origin, configurable prefix, and X-API-Key auth', async () => {
    const fetchMock = vi.fn(async () => jsonResponse([{ id: 'ds_1' }])) as unknown as typeof fetch;
    const client = new VectorAmp({ apiKey: 'sk_test', fetch: fetchMock });

    const page = await client.datasets.list({ limit: 10, offset: 20 });

    expect(page).toEqual({ data: [{ id: 'ds_1' }], limit: 10, offset: 20 });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.vectoramp.com/api/v1/datasets?limit=10&offset=20',
      expect.objectContaining({
        method: 'GET',
        headers: expect.any(Headers),
        body: undefined
      })
    );
    const headers = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].headers as Headers;
    expect(headers.get('X-API-Key')).toBe('sk_test');
    expect(headers.get('Accept')).toBe('application/json');
  });

  it('normalizes pagination envelopes returned by the API', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ items: [{ id: 'a' }], total: 5, next_offset: 1, has_more: true }));
    const client = new VectorAmp({ apiKey: 'sk', fetch: fetchMock as unknown as typeof fetch });

    await expect(client.datasets.list({ limit: 1, offset: 0 })).resolves.toEqual({
      data: [{ id: 'a' }],
      limit: 1,
      offset: 0,
      total: 5,
      nextOffset: 1,
      hasMore: true
    });
  });

  it('forces SABLE when creating datasets and ignores caller-provided index type', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ id: 'ds_1', index_type: 'sable' }, { status: 201 }));
    const client = new VectorAmp({ apiKey: 'sk', fetch: fetchMock as unknown as typeof fetch });

    await client.datasets.create({ name: 'docs', dimension: 768, indexType: 'hnsw' } as never);

    const request = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(JSON.parse(request.body as string)).toEqual({ name: 'docs', dimension: 768, index_type: 'sable' });
  });

  it('gets, deletes, searches, inserts vectors, and adds texts with simple dataset UX', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: 'a' }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(jsonResponse({ results: [{ id: 'v1', score: 0.99 }] }))
      .mockResolvedValueOnce(jsonResponse({ inserted: 1 }))
      .mockResolvedValueOnce(jsonResponse({ inserted: 2 }));
    const client = new VectorAmp({ apiKey: 'sk', baseUrl: 'https://example.test/', apiPrefix: 'v1', fetch: fetchMock as unknown as typeof fetch });

    await expect(client.datasets.get('a/b')).resolves.toEqual({ id: 'a' });
    await expect(client.datasets.delete('a/b')).resolves.toBeUndefined();
    await expect(client.datasets.search('ds', { queryText: 'hello', topK: 3, includeMetadata: true })).resolves.toEqual({
      results: [{ id: 'v1', score: 0.99 }]
    });
    await client.datasets.insert('ds', [{ id: 'v1', vector: [1, 2], metadata: { tag: 'x' } }]);
    await client.datasets.addTexts('ds', ['alpha', { text: 'beta', metadata: { kind: 'note' } }]);

    expect(fetchMock).toHaveBeenNthCalledWith(1, 'https://example.test/v1/datasets/a%2Fb', expect.objectContaining({ method: 'GET' }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'https://example.test/v1/datasets/a%2Fb', expect.objectContaining({ method: 'DELETE' }));
    expect(JSON.parse(fetchMock.mock.calls[2][1].body as string)).toMatchObject({ query_text: 'hello', top_k: 3, include_metadata: true });
    expect(JSON.parse(fetchMock.mock.calls[3][1].body as string)).toEqual({ vectors: [{ id: 'v1', vector: [1, 2], metadata: { tag: 'x' } }] });
    expect(JSON.parse(fetchMock.mock.calls[4][1].body as string)).toEqual({ texts: ['alpha', { text: 'beta', metadata: { kind: 'note' } }] });
  });

  it('supports ingestion from sources and local filesystem payloads', async () => {
    const root = join(tmpdir(), `vectoramp-sdk-${Date.now()}`);
    await mkdir(join(root, 'nested'), { recursive: true });
    await writeFile(join(root, 'one.md'), '# One');
    await writeFile(join(root, 'nested', 'two.txt'), 'Two');
    await writeFile(join(root, 'skip.bin'), 'nope');

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: 'job_source' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'job_fs' }));
    const client = new VectorAmp({ apiKey: 'sk', fetch: fetchMock as unknown as typeof fetch });

    await expect(client.datasets.ingestSource('ds', { source: 's3', uri: 's3://bucket/path' })).resolves.toEqual({ id: 'job_source' });
    await expect(client.datasets.ingestFilesystem('ds', root)).resolves.toEqual({ id: 'job_fs' });

    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({ source: 's3', uri: 's3://bucket/path' });
    const fsBody = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(fsBody.root).toBe(root);
    expect(fsBody.files).toEqual(
      expect.arrayContaining([
        { path: 'one.md', content: '# One' },
        { path: 'nested/two.txt', content: 'Two' }
      ])
    );
    expect(fsBody.files).toHaveLength(2);
  });

  it('supports non-streaming ask and streaming SSE ask', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('event: delta\ndata: {"token":"hi"}\n\n'));
        controller.enqueue(encoder.encode('data: plain\n\n'));
        controller.close();
      }
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ answer: 'hello' }))
      .mockResolvedValueOnce(new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } }));
    const client = new VectorAmp({ apiKey: 'sk', fetch: fetchMock as unknown as typeof fetch });

    await expect(client.ask('What is VectorAmp?')).resolves.toEqual({ answer: 'hello' });
    const events = [];
    for await (const event of client.askStream({ question: 'stream me', datasetId: 'ds' })) events.push(event);

    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({ question: 'What is VectorAmp?' });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body as string)).toEqual({ question: 'stream me', dataset_id: 'ds', stream: true });
    expect(events).toEqual([{ event: 'delta', data: { token: 'hi' } }, { data: 'plain' }]);
  });

  it('throws useful API errors', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ message: 'bad request' }, { status: 400 }));
    const client = new VectorAmp({ apiKey: 'sk', fetch: fetchMock as unknown as typeof fetch });

    await expect(client.datasets.get('missing')).rejects.toMatchObject({
      name: 'VectorAmpError',
      message: 'bad request',
      status: 400,
      body: { message: 'bad request' }
    } satisfies Partial<VectorAmpError>);
  });

  it('handles text responses, empty prefixes, and fallback error messages', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('OK', { status: 200, headers: { 'content-type': 'text/plain' } }))
      .mockResolvedValueOnce(new Response('nope', { status: 500, statusText: 'Server Error' }));
    const client = new VectorAmp({ apiKey: 'sk', baseUrl: 'https://example.test////', apiPrefix: '', fetch: fetchMock as unknown as typeof fetch });

    await expect(client.datasets.get('abc')).resolves.toBe('OK');
    await expect(client.datasets.get('abc')).rejects.toMatchObject({
      message: 'VectorAmp API request failed: 500 Server Error',
      body: 'nope'
    });
    expect(fetchMock.mock.calls[0][0]).toBe('https://example.test/datasets/abc');
  });

  it('validates dataset ids and streaming transport support', async () => {
    const client = new VectorAmp({ transport: { request: async <T,>() => undefined as T } });

    expect(() => client.datasets.get('')).toThrow('dataset id is required');
    await expect(async () => {
      for await (const _event of client.askStream('hi')) {
        // no-op
      }
    }).rejects.toThrow('does not support streaming');
  });

  it('parses SSE done markers, comments, ids, and retry fields', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(':keepalive\n\nid: 1\nretry: 1000\ndata: [DONE]\n\n'));
        controller.close();
      }
    });
    const fetchMock = vi.fn(async () => new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } }));
    const client = new VectorAmp({ apiKey: 'sk', fetch: fetchMock as unknown as typeof fetch });

    const events = [];
    for await (const event of client.askStream('done')) events.push(event);

    expect(events).toEqual([{ id: '1', retry: 1000, event: 'done', data: '[DONE]' }]);
  });

  it('can be constructed with a future non-REST transport', async () => {
    const calls: unknown[][] = [];
    const transport: Transport = {
      async request<T>(...args: Parameters<Transport['request']>): Promise<T> {
        calls.push(args);
        return { answer: args[1] } as T;
      }
    };
    const client = new VectorAmp({ transport });

    await expect(client.ask({ query: 'hello' })).resolves.toEqual({ answer: '/intelligence/query' });
    expect(calls).toEqual([['POST', '/intelligence/query', { body: { query: 'hello' } }]]);
  });
});
