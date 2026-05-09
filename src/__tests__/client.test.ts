import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DatasetResource,
  VectorAmp,
  VectorAmpError,
  confluenceSource,
  fileUploadSource,
  genericSource,
  gcsSource,
  googleDriveSource,
  jiraSource,
  s3Source,
  webSource,
  type SourceCreateInput,
  type Transport
} from '../index.js';

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

    expect(page).toMatchObject({ limit: 10, offset: 20 });
    expect(page.data[0]).toBeInstanceOf(DatasetResource);
    expect(page.data[0]).toMatchObject({ id: 'ds_1' });
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

    const page = await client.datasets.list({ limit: 1, offset: 0 });

    expect(page).toMatchObject({
      limit: 1,
      offset: 0,
      total: 5,
      nextOffset: 1,
      hasMore: true
    });
    expect(page.data[0]).toBeInstanceOf(DatasetResource);
    expect(page.data[0]).toMatchObject({ id: 'a' });
  });

  it('retries eligible ingestion jobs', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ job_id: 'job_2', status: 'pending' }));
    const client = new VectorAmp({ apiKey: 'sk', fetch: fetchMock as unknown as typeof fetch });

    await expect(client.ingestion.retryJob('job_1')).resolves.toEqual({ job_id: 'job_2', status: 'pending' });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.vectoramp.com/api/v1/ingestion/jobs/job_1/retry',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('forces SABLE when creating datasets and ignores caller-provided index type', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ id: 'ds_1', index_type: 'sable' }, { status: 201 }));
    const client = new VectorAmp({ apiKey: 'sk', fetch: fetchMock as unknown as typeof fetch });

    const dataset = await client.datasets.create({ name: 'docs', dimension: 768, indexType: 'hnsw' } as never);

    expect(dataset).toBeInstanceOf(DatasetResource);
    expect(dataset).toMatchObject({ id: 'ds_1', index_type: 'sable' });

    const request = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(JSON.parse(request.body as string)).toEqual({
      name: 'docs',
      dimension: 768,
      embedding: { provider: 'vectoramp', model: 'VectorAmp-Embedding-2560' },
      index_type: 'sable'
    });
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

    const dataset = await client.datasets.get('a/b');
    expect(dataset).toBeInstanceOf(DatasetResource);
    expect(dataset).toMatchObject({ id: 'a' });
    await expect(client.datasets.delete('a/b')).resolves.toBeUndefined();
    await expect(client.datasets.search('ds', 'hello')).resolves.toEqual({
      results: [{ id: 'v1', score: 0.99 }]
    });
    await client.datasets.insert('ds', [{ id: 'v1', vector: [1, 2], metadata: { tag: 'x' } }]);
    await client.datasets.addTexts('ds', 'alpha');

    expect(fetchMock).toHaveBeenNthCalledWith(1, 'https://example.test/v1/datasets/a%2Fb', expect.objectContaining({ method: 'GET' }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'https://example.test/v1/datasets/a%2Fb', expect.objectContaining({ method: 'DELETE' }));
    expect(JSON.parse(fetchMock.mock.calls[2][1].body as string)).toEqual({ query_text: 'hello' });
    expect(JSON.parse(fetchMock.mock.calls[3][1].body as string)).toEqual({ vectors: [{ id: 'v1', vector: [1, 2], metadata: { tag: 'x' } }] });
    expect(JSON.parse(fetchMock.mock.calls[4][1].body as string)).toEqual({ texts: ['alpha'] });
  });

  it('normalizes single-field hybrid search aliases', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ results: [] }));
    const client = new VectorAmp({ apiKey: 'sk', fetch: fetchMock as unknown as typeof fetch });

    await client.datasets.search('ds', { searchText: 'bm25 plus dense', topK: 3, hybrid: true, alpha: 0.7 });

    const request = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
    expect(JSON.parse(request.body as string)).toEqual({
      query_text: 'bm25 plus dense',
      top_k: 3,
      hybrid: true,
      alpha: 0.7
    });
  });

  it('lists and downloads dataset source documents', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ documents: [{ id: 'doc_1', file_name: 'a.md' }], next_cursor: 'doc_1' }))
      .mockResolvedValueOnce(new Response('hello', { status: 200, headers: { 'content-type': 'text/markdown' } }))
      .mockResolvedValueOnce(jsonResponse({ id: 'ds' }))
      .mockResolvedValueOnce(jsonResponse({ documents: [{ id: 'doc_2' }], total: 1 }))
      .mockResolvedValueOnce(new Response('world', { status: 200 }));
    const client = new VectorAmp({ apiKey: 'sk', fetch: fetchMock as unknown as typeof fetch });

    const page = await client.datasets.listDocuments('ds', { limit: 10, cursor: 'doc_0', status: 'ready' });
    expect(page.data).toEqual([{ id: 'doc_1', file_name: 'a.md' }]);
    expect(page.nextCursor).toBe('doc_1');
    await expect(client.datasets.downloadDocument('ds', 'doc_1')).resolves.toBeInstanceOf(ArrayBuffer);

    const dataset = await client.datasets.get('ds');
    await expect(dataset.listDocuments()).resolves.toMatchObject({ data: [{ id: 'doc_2' }] });
    const bytes = await dataset.downloadDocument('doc_2');
    expect(new TextDecoder().decode(bytes)).toBe('world');

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      'https://api.vectoramp.com/api/v1/datasets/ds/documents?limit=10&cursor=doc_0&status=ready',
      'https://api.vectoramp.com/api/v1/datasets/ds/documents/doc_1/download',
      'https://api.vectoramp.com/api/v1/datasets/ds',
      'https://api.vectoramp.com/api/v1/datasets/ds/documents',
      'https://api.vectoramp.com/api/v1/datasets/ds/documents/doc_2/download'
    ]);
  });

  it('returns dataset resources with instance methods that delegate to services', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: 'ds', name: 'Docs', metadata: { team: 'eng' } }, { status: 201 }))
      .mockResolvedValueOnce(jsonResponse({ results: [{ id: 'v1', score: 0.9 }] }))
      .mockResolvedValueOnce(jsonResponse({ inserted: 1 }))
      .mockResolvedValueOnce(jsonResponse({ inserted: 2 }))
      .mockResolvedValueOnce(jsonResponse({ answer: 'because SABLE' }))
      .mockResolvedValueOnce(jsonResponse({ answer: 'with context' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'job_source' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'src_files' }, { status: 201 }))
      .mockResolvedValueOnce(jsonResponse({ id: 'job_files' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'src_fs' }, { status: 201 }))
      .mockResolvedValueOnce(jsonResponse({ id: 'job_fs' }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const client = new VectorAmp({ apiKey: 'sk', fetch: fetchMock as unknown as typeof fetch });
    const root = join(tmpdir(), `vectoramp-sdk-resource-${Date.now()}`);
    await mkdir(root, { recursive: true });
    await writeFile(join(root, 'note.md'), 'Note');

    const dataset = await client.datasets.create({ name: 'Docs' });

    expect(dataset).toBeInstanceOf(DatasetResource);
    expect(dataset.id).toBe('ds');
    expect(dataset.rawData).toEqual({ id: 'ds', name: 'Docs', metadata: { team: 'eng' } });
    expect(Object.keys(dataset)).not.toContain('service');
    await expect(dataset.search({ queryText: 'sable', topK: 1 })).resolves.toEqual({ results: [{ id: 'v1', score: 0.9 }] });
    await expect(dataset.insert([{ id: 'v1', vector: [1, 2, 3] }])).resolves.toEqual({ inserted: 1 });
    await expect(dataset.addTexts(['hello'])).resolves.toEqual({ inserted: 2 });
    await expect(dataset.ask('why?')).resolves.toEqual({ answer: 'because SABLE' });
    await expect(dataset.ask({ question: 'why with context?', topK: 2 })).resolves.toEqual({ answer: 'with context' });
    await expect(dataset.ingestSource({ source: 's3', uri: 's3://bucket/docs' })).resolves.toEqual({ id: 'job_source' });
    await expect(dataset.ingestFiles({ files: [{ path: 'a.md', content: 'A' }] })).resolves.toEqual({ id: 'job_files' });
    await expect(dataset.ingestFilesystem(root)).resolves.toEqual({ id: 'job_fs' });
    await expect(dataset.delete()).resolves.toBeUndefined();
    expect(() => new DatasetResource(dataset.service, { id: 'orphan' }).ask('hi')).toThrow('dataset ask requires a VectorAmp client context');

    expect(JSON.parse(fetchMock.mock.calls[4][1].body as string)).toEqual({ question: 'why?', dataset_id: 'ds' });
    expect(JSON.parse(fetchMock.mock.calls[5][1].body as string)).toEqual({ question: 'why with context?', top_k: 2, dataset_id: 'ds' });
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      'https://api.vectoramp.com/api/v1/datasets',
      'https://api.vectoramp.com/api/v1/datasets/ds/search',
      'https://api.vectoramp.com/api/v1/datasets/ds/vectors',
      'https://api.vectoramp.com/api/v1/datasets/ds/texts',
      'https://api.vectoramp.com/api/v1/intelligence/query',
      'https://api.vectoramp.com/api/v1/intelligence/query',
      'https://api.vectoramp.com/api/v1/datasets/ds/ingestions/sources',
      'https://api.vectoramp.com/api/v1/ingestion/sources',
      'https://api.vectoramp.com/api/v1/datasets/ds/ingestions/filesystem',
      'https://api.vectoramp.com/api/v1/ingestion/sources',
      'https://api.vectoramp.com/api/v1/datasets/ds/ingestions/filesystem',
      'https://api.vectoramp.com/api/v1/datasets/ds'
    ]);
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
      .mockResolvedValueOnce(jsonResponse({ id: 'job_source_id' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'src_fs' }, { status: 201 }))
      .mockResolvedValueOnce(jsonResponse({ id: 'job_fs' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'job_existing_source' }));
    const client = new VectorAmp({ apiKey: 'sk', fetch: fetchMock as unknown as typeof fetch });

    await expect(client.datasets.ingestSource('ds', { source: 's3', uri: 's3://bucket/path' })).resolves.toEqual({ id: 'job_source' });
    await expect(client.datasets.ingestSource('ds', 'src_123')).resolves.toEqual({ id: 'job_source_id' });
    await expect(client.datasets.ingestFilesystem('ds', root)).resolves.toEqual({ id: 'job_fs' });
    await expect(client.datasets.ingestFiles('ds', { sourceId: 'existing_src', source_id: undefined, files: [{ path: 'three.md', content: 'Three' }] })).resolves.toEqual({ id: 'job_existing_source' });

    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({ source: 's3', uri: 's3://bucket/path' });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body as string)).toEqual({ source_id: 'src_123' });
    expect(JSON.parse(fetchMock.mock.calls[2][1].body as string)).toEqual({ source_type: 'file_upload', name: expect.stringMatching(/^Local files: /) });
    const fsBody = JSON.parse(fetchMock.mock.calls[3][1].body as string);
    expect(fsBody.source_id).toBe('src_fs');
    expect(fsBody.root).toBe(root);
    expect(fsBody.files).toEqual(
      expect.arrayContaining([
        { path: 'one.md', content: '# One' },
        { path: 'nested/two.txt', content: 'Two' }
      ])
    );
    expect(fsBody.files).toHaveLength(2);
    expect(JSON.parse(fetchMock.mock.calls[4][1].body as string)).toEqual({ files: [{ path: 'three.md', content: 'Three' }], source_id: 'existing_src' });
  });

  it('builds typed ingestion sources and creates them through client.sources', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: 'src_web', source_type: 'web' }, { status: 201 }))
      .mockResolvedValueOnce(jsonResponse({ id: 'src_s3', source_type: 's3' }, { status: 201 }))
      .mockResolvedValueOnce(jsonResponse({ id: 'src_gcs', source_type: 'gcs' }, { status: 201 }))
      .mockResolvedValueOnce(jsonResponse({ id: 'src_gdrive', source_type: 'gdrive' }, { status: 201 }))
      .mockResolvedValueOnce(jsonResponse({ id: 'src_upload', source_type: 'file_upload' }, { status: 201 }))
      .mockResolvedValueOnce(jsonResponse({ id: 'src_jira', source_type: 'jira' }, { status: 201 }))
      .mockResolvedValueOnce(jsonResponse({ id: 'src_confluence', source_type: 'confluence' }, { status: 201 }))
      .mockResolvedValueOnce(jsonResponse({ id: 'job_inline' }));
    const client = new VectorAmp({ apiKey: 'sk', fetch: fetchMock as unknown as typeof fetch });

    const typedWeb = webSource({ url: 'https://example.com/docs', config: { maxDepth: 2 } }) satisfies SourceCreateInput;
    expect(s3Source('s3://bucket/docs')).toEqual({ source_type: 's3', uri: 's3://bucket/docs' });
    expect(gcsSource({ bucket: 'docs-bucket', prefix: 'docs/' })).toEqual({ source_type: 'gcs', bucket: 'docs-bucket', prefix: 'docs/' });
    expect(googleDriveSource({ folderId: 'folder_1' })).toEqual({ source_type: 'gdrive', folderId: 'folder_1' });
    expect(fileUploadSource({ fileIds: ['file_1'] })).toEqual({ source_type: 'file_upload', name: 'Local file upload', fileIds: ['file_1'] });
    expect(jiraSource({ cloudId: 'cloud_1', projectKeys: ['ENG'] })).toEqual({ source_type: 'jira', includeComments: true, cloudId: 'cloud_1', projectKeys: ['ENG'] });
    expect(confluenceSource({ cloudId: 'cloud_1', spaceKeys: ['DOCS'] })).toEqual({ source_type: 'confluence', cloudId: 'cloud_1', spaceKeys: ['DOCS'] });
    expect(genericSource('custom_source', { uri: 'custom://source' })).toEqual({ source_type: 'custom_source', uri: 'custom://source' });

    await expect(client.sources.createWeb({ url: 'https://example.com/docs', config: { maxDepth: 2 } })).resolves.toMatchObject({ id: 'src_web' });
    await expect(client.sources.createS3({ uri: 's3://bucket/docs', region: 'us-east-1' })).resolves.toMatchObject({ id: 'src_s3' });
    await expect(client.sources.createGcs({ bucket: 'docs-bucket', prefix: 'docs/' })).resolves.toMatchObject({ id: 'src_gcs' });
    await expect(client.sources.createGoogleDrive({ folderId: 'folder_1' })).resolves.toMatchObject({ id: 'src_gdrive' });
    await expect(client.sources.createFileUpload({ fileIds: ['file_1'] })).resolves.toMatchObject({ id: 'src_upload' });
    await expect(client.sources.createJira({ cloudId: 'cloud_1', accessToken: 'token', projectKeys: ['ENG'] })).resolves.toMatchObject({ id: 'src_jira' });
    await expect(client.sources.createConfluence({ cloudId: 'cloud_1', accessToken: 'token', spaceKeys: ['DOCS'] })).resolves.toMatchObject({ id: 'src_confluence' });
    await expect(client.datasets.ingestSource('ds', typedWeb)).resolves.toEqual({ id: 'job_inline' });

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      'https://api.vectoramp.com/api/v1/ingestion/sources',
      'https://api.vectoramp.com/api/v1/ingestion/sources',
      'https://api.vectoramp.com/api/v1/ingestion/sources',
      'https://api.vectoramp.com/api/v1/ingestion/sources',
      'https://api.vectoramp.com/api/v1/ingestion/sources',
      'https://api.vectoramp.com/api/v1/ingestion/sources',
      'https://api.vectoramp.com/api/v1/ingestion/sources',
      'https://api.vectoramp.com/api/v1/datasets/ds/ingestions/sources'
    ]);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({
      source_type: 'web',
      uri: 'https://example.com/docs',
      config: { max_depth: 2 }
    });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body as string)).toEqual({ source_type: 's3', uri: 's3://bucket/docs', region: 'us-east-1' });
    expect(JSON.parse(fetchMock.mock.calls[2][1].body as string)).toEqual({ source_type: 'gcs', bucket: 'docs-bucket', prefix: 'docs/' });
    expect(JSON.parse(fetchMock.mock.calls[3][1].body as string)).toEqual({ source_type: 'gdrive', folder_id: 'folder_1' });
    expect(JSON.parse(fetchMock.mock.calls[4][1].body as string)).toEqual({ source_type: 'file_upload', name: 'Local file upload', file_ids: ['file_1'] });
    expect(JSON.parse(fetchMock.mock.calls[5][1].body as string)).toEqual({ source_type: 'jira', include_comments: true, cloud_id: 'cloud_1', access_token: 'token', project_keys: ['ENG'] });
    expect(JSON.parse(fetchMock.mock.calls[6][1].body as string)).toEqual({ source_type: 'confluence', cloud_id: 'cloud_1', access_token: 'token', space_keys: ['DOCS'] });
    expect(JSON.parse(fetchMock.mock.calls[7][1].body as string)).toEqual({
      source_type: 'web',
      uri: 'https://example.com/docs',
      config: { max_depth: 2 }
    });
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
      .mockResolvedValueOnce(jsonResponse({ id: 'abc' }))
      .mockResolvedValueOnce(new Response('nope', { status: 500, statusText: 'Server Error' }));
    const client = new VectorAmp({ apiKey: 'sk', baseUrl: 'https://example.test////', apiPrefix: '', fetch: fetchMock as unknown as typeof fetch });

    await expect(client.datasets.get('abc')).resolves.toMatchObject({ id: 'abc' });
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
