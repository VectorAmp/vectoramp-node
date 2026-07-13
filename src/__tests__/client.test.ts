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
  openai,
  type SourceCreateInput,
  type Transport
} from '../index.js';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const status = init.status ?? 200;
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...(init.headers as Record<string, string> | undefined) }
  });
}

describe('VectorAmp client', () => {
  afterEach(() => vi.restoreAllMocks());

  it('uses the default unprefixed API origin and X-API-Key auth', async () => {
    const fetchMock = vi.fn(async () => jsonResponse([{ id: 'ds_1' }])) as unknown as typeof fetch;
    const client = new VectorAmp({ apiKey: 'sk_test', fetch: fetchMock });

    const page = await client.datasets.list({ limit: 10, offset: 20 });

    expect(page).toMatchObject({ limit: 10, offset: 20 });
    expect(page.data[0]).toBeInstanceOf(DatasetResource);
    expect(page.data[0]).toMatchObject({ id: 'ds_1' });
    // Paths are unprefixed on the public gateway: /api/v1 would 404.
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.vectoramp.com/datasets?limit=10&offset=20',
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
      'https://api.vectoramp.com/ingestion/jobs/job_1/retry',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('exposes the source + job lifecycle through client.ingestion and client.sources', async () => {
    const fetchMock = vi
      .fn()
      // client.ingestion.listSources
      .mockResolvedValueOnce(jsonResponse({ sources: [{ id: 'src_1' }], total: 1 }))
      // client.ingestion.getSource
      .mockResolvedValueOnce(jsonResponse({ id: 'src_1', source_type: 'web' }))
      // client.ingestion.startJob
      .mockResolvedValueOnce(jsonResponse({ id: 'job_1', status: 'pending' }))
      // client.ingestion.listJobs (filtered by dataset)
      .mockResolvedValueOnce(jsonResponse({ jobs: [{ id: 'job_1' }], total: 1 }))
      // client.ingestion.getJob
      .mockResolvedValueOnce(jsonResponse({ id: 'job_1', status: 'completed' }))
      // client.sources alias delegates the same surface
      .mockResolvedValueOnce(jsonResponse({ jobs: [{ id: 'job_1' }] }));
    const client = new VectorAmp({ apiKey: 'sk', fetch: fetchMock as unknown as typeof fetch });

    await expect(client.ingestion.listSources({ limit: 10 })).resolves.toMatchObject({ total: 1 });
    await expect(client.ingestion.getSource('src_1')).resolves.toMatchObject({ id: 'src_1' });
    await expect(client.ingestion.startJob({ sourceId: 'src_1', datasetId: 'ds', pipelineId: 'pl_1' })).resolves.toMatchObject({ id: 'job_1' });
    await expect(client.ingestion.listJobs({ datasetId: 'ds', limit: 5 })).resolves.toMatchObject({ total: 1 });
    await expect(client.ingestion.getJob('job_1')).resolves.toMatchObject({ status: 'completed' });
    await expect(client.sources.listJobs({ datasetId: 'ds' })).resolves.toMatchObject({ data: [{ id: 'job_1' }] });

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      'https://api.vectoramp.com/ingestion/sources?limit=10',
      'https://api.vectoramp.com/ingestion/sources/src_1',
      'https://api.vectoramp.com/ingestion/jobs',
      'https://api.vectoramp.com/ingestion/jobs?limit=5&dataset_id=ds',
      'https://api.vectoramp.com/ingestion/jobs/job_1',
      'https://api.vectoramp.com/ingestion/jobs?dataset_id=ds'
    ]);
    expect(JSON.parse(fetchMock.mock.calls[2][1].body as string)).toEqual({
      source_id: 'src_1',
      dataset_id: 'ds',
      pipeline_id: 'pl_1'
    });
  });

  it('creates sources through the client.sources alias', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: 'src_g', source_type: 'gdrive' }, { status: 201 }))
      .mockResolvedValueOnce(jsonResponse({ id: 'src_1', source_type: 'web' }));
    const client = new VectorAmp({ apiKey: 'sk', fetch: fetchMock as unknown as typeof fetch });

    await expect(client.sources.create(genericSource('gdrive', { folderId: 'f1' }))).resolves.toMatchObject({ id: 'src_g' });
    await expect(client.sources.get('src_1')).resolves.toMatchObject({ id: 'src_1' });

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      'https://api.vectoramp.com/ingestion/sources',
      'https://api.vectoramp.com/ingestion/sources/src_1'
    ]);
  });

  it('accepts URI/string shorthands for every source factory', () => {
    expect(webSource('https://docs.example.com')).toEqual({ source_type: 'web', uri: 'https://docs.example.com' });
    expect(s3Source('s3://b/p')).toEqual({ source_type: 's3', uri: 's3://b/p' });
    expect(gcsSource('gs://b/p')).toEqual({ source_type: 'gcs', uri: 'gs://b/p' });
    expect(googleDriveSource('drive-folder-id')).toEqual({ source_type: 'gdrive', uri: 'drive-folder-id' });
    expect(fileUploadSource()).toEqual({ source_type: 'file_upload', name: 'Local file upload' });
    expect(jiraSource({ includeComments: false, cloudId: 'c' })).toEqual({ source_type: 'jira', includeComments: false, cloudId: 'c' });
  });

  it('creates every source type through the dedicated client.sources helpers', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ id: 'src' }, { status: 201 }));
    const client = new VectorAmp({ apiKey: 'sk', fetch: fetchMock as unknown as typeof fetch });

    await client.sources.createWeb('https://docs.example.com');
    await client.sources.createS3('s3://b/p');
    await client.sources.createGcs('gs://b/p');
    await client.sources.createGoogleDrive('folder-id');
    await client.sources.createFileUpload();
    await client.sources.createJira({ cloudId: 'c', accessToken: 't' });
    await client.sources.createConfluence({ baseUrl: 'https://acme.atlassian.net', username: 'u', config: { apiToken: 't' } });

    const calls = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.map((call) => JSON.parse(call[1].body as string).source_type)).toEqual([
      'web',
      's3',
      'gcs',
      'gdrive',
      'file_upload',
      'jira',
      'confluence'
    ]);
  });

  it('rejects ingestFiles without paths or upload support', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}));
    const client = new VectorAmp({ apiKey: 'sk', fetch: fetchMock as unknown as typeof fetch });
    await expect(client.datasets.ingestFiles('ds', [])).rejects.toThrow(/at least one file path/);

    const noPutClient = new VectorAmp({ transport: { request: async <T,>() => ({}) as T } });
    await expect(noPutClient.datasets.ingestFiles('ds', ['/tmp/x.md'])).rejects.toThrow(/does not support presigned file uploads/);
  });

  it('surfaces presigned PUT failures and back-fills the job id', async () => {
    const root = join(tmpdir(), `vectoramp-sdk-put-${Date.now()}`);
    await mkdir(root, { recursive: true });
    const filePath = join(root, 'doc.txt');
    await writeFile(filePath, 'hello');

    // PUT failure path.
    const failingFetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: 'src_files' }, { status: 201 }))
      .mockResolvedValueOnce(jsonResponse({ job_id: 'upl_1', uploads: [{ file_id: 'f1', upload_url: 'https://up.example.com/f1' }] }))
      .mockResolvedValueOnce(new Response('denied', { status: 403, statusText: 'Forbidden' }));
    const failingClient = new VectorAmp({ apiKey: 'sk', fetch: failingFetch as unknown as typeof fetch });
    await expect(failingClient.datasets.ingestFiles('ds', [filePath])).rejects.toThrow(/Presigned file upload failed/);

    // Successful flow where complete returns no id: the SDK back-fills the upload job id.
    const okFetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: 'src_files' }, { status: 201 }))
      .mockResolvedValueOnce(jsonResponse({ job_id: 'upl_2', uploads: [{ file_id: 'f1', upload_url: 'https://up.example.com/f1' }] }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(jsonResponse({ status: 'pending' }));
    const okClient = new VectorAmp({ apiKey: 'sk', fetch: okFetch as unknown as typeof fetch });
    await expect(okClient.datasets.ingestFiles('ds', [filePath])).resolves.toMatchObject({ id: 'upl_2', status: 'pending' });
  });

  it('forces SABLE when creating datasets and ignores caller-provided index type', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ id: 'ds_1', index_type: 'sable' }, { status: 201 }));
    const client = new VectorAmp({ apiKey: 'sk', fetch: fetchMock as unknown as typeof fetch });

    const dataset = await client.datasets.create({ name: 'docs', dim: 768, indexType: 'hnsw' } as never);

    expect(dataset).toBeInstanceOf(DatasetResource);
    expect(dataset).toMatchObject({ id: 'ds_1', index_type: 'sable' });

    const request = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1];
    // The create body uses "dim" (not "dimension") and always forces SABLE.
    expect(JSON.parse(request.body as string)).toEqual({
      name: 'docs',
      dim: 768,
      embedding: { provider: 'vectoramp', model: 'VectorAmp-Embedding-4B' },
      index_type: 'sable'
    });
  });

  it('creates a dataset from only a name using built-in defaults', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ id: 'ds_min', index_type: 'sable' }, { status: 201 }));
    const client = new VectorAmp({ apiKey: 'sk', fetch: fetchMock as unknown as typeof fetch });

    await client.datasets.create({ name: 'docs' });

    const request = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1];
    // Minimal create: default VectorAmp-Embedding-4B (dim 2560), SABLE forced.
    expect(JSON.parse(request.body as string)).toEqual({
      name: 'docs',
      dim: 2560,
      embedding: { provider: 'vectoramp', model: 'VectorAmp-Embedding-4B' },
      index_type: 'sable'
    });
    expect((fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe('https://api.vectoramp.com/datasets');
  });

  it('creates a hybrid dataset when hybrid is requested', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ id: 'ds_hybrid', index_type: 'sable' }, { status: 201 }));
    const client = new VectorAmp({ apiKey: 'sk', fetch: fetchMock as unknown as typeof fetch });

    await client.datasets.create({ name: 'docs', hybrid: true });

    const request = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(JSON.parse(request.body as string)).toEqual({
      name: 'docs',
      hybrid: true,
      dim: 2560,
      embedding: { provider: 'vectoramp', model: 'VectorAmp-Embedding-4B' },
      index_type: 'sable'
    });
  });

  it('requires an explicit dim for unknown custom embedding models', async () => {
    const client = new VectorAmp({ apiKey: 'sk', fetch: vi.fn() as unknown as typeof fetch });

    await expect(
      client.datasets.create({ name: 'docs', embedding: { provider: 'acme', model: 'acme-embed-1' } })
    ).rejects.toThrow(/Unable to infer vector dimension/);
  });

  it('accepts snake_case embedding aliases and the dimension alias on create', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ id: 'ds_alias', index_type: 'sable' }, { status: 201 }));
    const client = new VectorAmp({ apiKey: 'sk', fetch: fetchMock as unknown as typeof fetch });

    await client.datasets.create({
      name: 'docs',
      // snake_case provider/model aliases plus the deprecated "dimension" alias.
      embedding_provider: 'acme',
      embedding_model: 'acme-embed-1',
      dimension: 512
    } as never);

    const request = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(JSON.parse(request.body as string)).toEqual({
      name: 'docs',
      dim: 512,
      embedding: { provider: 'acme', model: 'acme-embed-1' },
      index_type: 'sable'
    });
  });

  it('creates OpenAI embedding datasets with the short helper', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ id: 'ds_openai', index_type: 'sable' }, { status: 201 }));
    const client = new VectorAmp({ apiKey: 'sk', fetch: fetchMock as unknown as typeof fetch });

    await client.datasets.create({ name: 'openai-docs', embedding: openai('large') });

    const request = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(JSON.parse(request.body as string)).toEqual({
      name: 'openai-docs',
      dim: 3072,
      embedding: { provider: 'openai', model: 'text-embedding-3-large', secret_ref: 'emb:openai:api_key' },
      index_type: 'sable'
    });
  });

  it('can save an OpenAI API key while creating an OpenAI dataset', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(jsonResponse({ id: 'ds_openai', index_type: 'sable' }, { status: 201 }));
    const client = new VectorAmp({ apiKey: 'sk', fetch: fetchMock as unknown as typeof fetch });

    await client.datasets.create({ name: 'openai-docs', openaiApiKey: 'sk-openai' });

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      'https://api.vectoramp.com/org-secrets/emb%3Aopenai%3Aapi_key',
      'https://api.vectoramp.com/datasets'
    ]);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({ value: 'sk-openai' });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body as string)).toEqual({
      name: 'openai-docs',
      dim: 1536,
      embedding: { provider: 'openai', model: 'text-embedding-3-small', secret_ref: 'emb:openai:api_key' },
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
      .mockResolvedValueOnce(jsonResponse({ deleted: 1, requested: 1 }))
      .mockResolvedValueOnce(jsonResponse({ embeddings: [[1, 2]] }))
      .mockResolvedValueOnce(jsonResponse({ inserted: 2 }));
    const client = new VectorAmp({ apiKey: 'sk', baseUrl: 'https://example.test/', apiPrefix: 'v1', fetch: fetchMock as unknown as typeof fetch });

    const dataset = await client.datasets.get('a/b');
    expect(dataset).toBeInstanceOf(DatasetResource);
    expect(dataset).toMatchObject({ id: 'a' });
    await expect(client.datasets.delete('a/b')).resolves.toBeUndefined();
    await expect(client.datasets.search('ds', 'hello')).resolves.toEqual({
      results: [{ id: 'v1', score: 0.99 }]
    });
    await client.datasets.insert('ds', [{ id: 'v1', values: [1, 2], metadata: { tag: 'x' } }]);
    await expect(client.datasets.deleteVectors('ds', { ids: ['v1'], writeConcern: 'all' })).resolves.toEqual({ deleted: 1, requested: 1 });
    await client.datasets.addTexts('ds', 'alpha');

    expect(fetchMock).toHaveBeenNthCalledWith(1, 'https://example.test/v1/datasets/a%2Fb', expect.objectContaining({ method: 'GET' }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'https://example.test/v1/datasets/a%2Fb', expect.objectContaining({ method: 'DELETE' }));
    // insert posts to /insert, vector deletion uses /vectors.
    expect(fetchMock.mock.calls[3][0]).toBe('https://example.test/v1/datasets/ds/insert');
    expect(fetchMock.mock.calls[4][0]).toBe('https://example.test/v1/datasets/ds/vectors');
    expect(fetchMock.mock.calls[4][1].method).toBe('DELETE');
    expect(JSON.parse(fetchMock.mock.calls[2][1].body as string)).toEqual({ query_text: 'hello' });
    expect(JSON.parse(fetchMock.mock.calls[3][1].body as string)).toEqual({ vectors: [{ id: 'v1', values: [1, 2], metadata: { tag: 'x' } }] });
    expect(JSON.parse(fetchMock.mock.calls[4][1].body as string)).toEqual({ ids: ['v1'], write_concern: 'all' });
    expect(JSON.parse(fetchMock.mock.calls[5][1].body as string)).toEqual({ texts: ['alpha'] });
    expect(JSON.parse(fetchMock.mock.calls[6][1].body as string)).toEqual({
      vectors: [{ id: 'text-1', values: [1, 2], metadata: { text: 'alpha' } }]
    });
  });

  it('preserves numeric vector ids as JSON numbers on insert', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ inserted: 2 }));
    const client = new VectorAmp({ apiKey: 'sk', fetch: fetchMock as unknown as typeof fetch });

    await client.datasets.insert('ds', [
      { id: 42, values: [0.1, 0.2] },
      { id: 'str-id', values: [0.3, 0.4] }
    ]);

    const calls = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const rawBody = calls[0][1].body as string;
    // The integer id must serialize as a JSON number (42), not a string ("42").
    expect(rawBody).toContain('"id":42');
    expect(rawBody).not.toContain('"id":"42"');
    const parsed = JSON.parse(rawBody);
    expect(parsed.vectors[0].id).toBe(42);
    expect(typeof parsed.vectors[0].id).toBe('number');
    expect(parsed.vectors[1].id).toBe('str-id');
    // The vector array is sent under the engine's canonical `values` field.
    expect(parsed.vectors[0].values).toEqual([0.1, 0.2]);
    expect(calls[0][0]).toBe('https://api.vectoramp.com/datasets/ds/insert');
  });

  it('sends the vector array under `values` and accepts `vector` as a legacy alias', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ inserted: 1 }));
    const client = new VectorAmp({ apiKey: 'sk', fetch: fetchMock as unknown as typeof fetch });

    // Legacy callers may still pass `vector`; it is normalized to `values`.
    await client.datasets.insert('ds', [{ id: 'v1', vector: [1, 2, 3] } as unknown as { id: string; values: number[] }]);

    const body = JSON.parse((fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string);
    expect(body.vectors[0].values).toEqual([1, 2, 3]);
    expect(body.vectors[0].vector).toBeUndefined();
  });

  it('normalizes single-field hybrid search aliases', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ results: [] }));
    const client = new VectorAmp({ apiKey: 'sk', fetch: fetchMock as unknown as typeof fetch });

    await client.datasets.search('ds', { searchText: 'bm25 plus dense', topK: 3, hybrid: true, alpha: 0.7, rerank: true });

    const request = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
    expect(JSON.parse(request.body as string)).toEqual({
      query_text: 'bm25 plus dense',
      top_k: 3,
      hybrid: true,
      alpha: 0.7,
      rerank: true
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
      'https://api.vectoramp.com/datasets/ds/documents?limit=10&cursor=doc_0&status=ready',
      'https://api.vectoramp.com/datasets/ds/documents/doc_1/download',
      'https://api.vectoramp.com/datasets/ds',
      'https://api.vectoramp.com/datasets/ds/documents',
      'https://api.vectoramp.com/datasets/ds/documents/doc_2/download'
    ]);
  });

  it('returns dataset resources with instance methods that delegate to services', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: 'ds', name: 'Docs', metadata: { team: 'eng' } }, { status: 201 }))
      .mockResolvedValueOnce(jsonResponse({ results: [{ id: 'v1', score: 0.9 }] }))
      .mockResolvedValueOnce(jsonResponse({ inserted: 1 }))
      .mockResolvedValueOnce(jsonResponse({ embeddings: [[1, 2, 3]] }))
      .mockResolvedValueOnce(jsonResponse({ inserted: 2 }))
      .mockResolvedValueOnce(jsonResponse({ answer: 'because SABLE' }))
      .mockResolvedValueOnce(jsonResponse({ answer: 'with context' }))
      // ingestSource with an existing source id -> POST /ingestion/jobs
      .mockResolvedValueOnce(jsonResponse({ id: 'job_source' }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const client = new VectorAmp({ apiKey: 'sk', fetch: fetchMock as unknown as typeof fetch });

    const dataset = await client.datasets.create({ name: 'Docs' });

    expect(dataset).toBeInstanceOf(DatasetResource);
    expect(dataset.id).toBe('ds');
    expect(dataset.rawData).toEqual({ id: 'ds', name: 'Docs', metadata: { team: 'eng' } });
    expect(Object.keys(dataset)).not.toContain('service');
    await expect(dataset.search({ queryText: 'sable', topK: 1, rerank: { enabled: true } })).resolves.toEqual({ results: [{ id: 'v1', score: 0.9 }] });
    await expect(dataset.insert([{ id: 'v1', values: [1, 2, 3] }])).resolves.toEqual({ inserted: 1 });
    await expect(dataset.addTexts(['hello'])).resolves.toEqual({ inserted: 2 });
    await expect(dataset.ask('why?')).resolves.toEqual({ answer: 'because SABLE' });
    await expect(dataset.ask({ question: 'why with context?', topK: 2 })).resolves.toEqual({ answer: 'with context' });
    await expect(dataset.ingestSource('src_123')).resolves.toEqual({ id: 'job_source' });
    await expect(dataset.delete()).resolves.toBeUndefined();
    expect(() => new DatasetResource(dataset.service, { id: 'orphan' }).ask('hi')).toThrow('dataset ask requires a VectorAmp client context');

    // A bare string ask becomes { query }; dataset id is injected.
    expect(JSON.parse(fetchMock.mock.calls[5][1].body as string)).toEqual({ query: 'why?', dataset_id: 'ds' });
    expect(JSON.parse(fetchMock.mock.calls[6][1].body as string)).toEqual({ question: 'why with context?', top_k: 2, dataset_id: 'ds' });
    // ingestSource with an existing id starts a job directly.
    expect(JSON.parse(fetchMock.mock.calls[7][1].body as string)).toEqual({ source_id: 'src_123', dataset_id: 'ds' });
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      'https://api.vectoramp.com/datasets',
      'https://api.vectoramp.com/datasets/ds/search',
      'https://api.vectoramp.com/datasets/ds/insert',
      'https://api.vectoramp.com/datasets/ds/embed',
      'https://api.vectoramp.com/datasets/ds/insert',
      'https://api.vectoramp.com/intelligence/query',
      'https://api.vectoramp.com/intelligence/query',
      'https://api.vectoramp.com/ingestion/jobs',
      'https://api.vectoramp.com/datasets/ds'
    ]);
  });

  it('throws when the embed endpoint returns a mismatched number of embeddings', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ embeddings: [[1, 2]] }));
    const client = new VectorAmp({ apiKey: 'sk', fetch: fetchMock as unknown as typeof fetch });

    await expect(client.datasets.addTexts('ds', ['a', 'b'])).rejects.toThrow(/returned 1 embeddings for 2 texts/);
  });

  it('ingestSource starts a job from an existing source reference object', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ id: 'job_ref', status: 'pending' }));
    const client = new VectorAmp({ apiKey: 'sk', fetch: fetchMock as unknown as typeof fetch });

    // A reference object ({ source_id }) is treated as an existing source: no create call.
    await expect(client.datasets.ingestSource('ds', { source_id: 'src_existing' })).resolves.toMatchObject({ id: 'job_ref' });

    const calls = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe('https://api.vectoramp.com/ingestion/jobs');
    expect(JSON.parse(calls[0][1].body as string)).toEqual({ source_id: 'src_existing', dataset_id: 'ds' });
  });

  it('ingestSource creates a source from a builder before starting the job', async () => {
    const fetchMock = vi
      .fn()
      // create source from the webSource builder
      .mockResolvedValueOnce(jsonResponse({ id: 'src_web', source_type: 'web' }, { status: 201 }))
      // start the job
      .mockResolvedValueOnce(jsonResponse({ id: 'job_web', status: 'pending' }));
    const client = new VectorAmp({ apiKey: 'sk', fetch: fetchMock as unknown as typeof fetch });

    await expect(
      client.datasets.ingestSource('ds', webSource('https://docs.example.com'), { pipelineId: 'pl_1' })
    ).resolves.toEqual({ id: 'job_web', status: 'pending' });

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      'https://api.vectoramp.com/ingestion/sources',
      'https://api.vectoramp.com/ingestion/jobs'
    ]);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({ source_type: 'web', uri: 'https://docs.example.com' });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body as string)).toEqual({
      source_id: 'src_web',
      dataset_id: 'ds',
      pipeline_id: 'pl_1'
    });
  });

  it('ingestFiles runs the presigned upload flow (init -> PUT -> complete)', async () => {
    const root = join(tmpdir(), `vectoramp-sdk-upload-${Date.now()}`);
    await mkdir(root, { recursive: true });
    const filePath = join(root, 'intro.md');
    await writeFile(filePath, '# Intro');

    const fetchMock = vi
      .fn()
      // create file_upload source
      .mockResolvedValueOnce(jsonResponse({ id: 'src_files', source_type: 'file_upload' }, { status: 201 }))
      // upload/init
      .mockResolvedValueOnce(
        jsonResponse({ job_id: 'upl_1', uploads: [{ file_id: 'file_1', upload_url: 'https://uploads.example.com/file_1?sig=abc' }] })
      )
      // PUT presigned url
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      // upload/complete
      .mockResolvedValueOnce(jsonResponse({ job_id: 'job_files', status: 'pending' }));
    const client = new VectorAmp({ apiKey: 'sk', fetch: fetchMock as unknown as typeof fetch });

    await expect(client.datasets.ingestFiles('ds', [filePath], { sourceName: 'Docs upload' })).resolves.toMatchObject({
      job_id: 'job_files'
    });

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      'https://api.vectoramp.com/ingestion/sources',
      'https://api.vectoramp.com/ingestion/sources/src_files/upload/init',
      'https://uploads.example.com/file_1?sig=abc',
      'https://api.vectoramp.com/ingestion/sources/src_files/upload/complete'
    ]);
    // Auto-created file_upload source carries dataset_id + storage defaults.
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({
      source_type: 'file_upload',
      name: 'Docs upload',
      config: { storage_provider: 's3', sync_mode: 'full' },
      metadata: { dataset_id: 'ds' }
    });
    const initBody = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(initBody.files[0]).toMatchObject({ name: 'intro.md', content_type: 'text/markdown' });
    expect(initBody.files[0].size_bytes).toBeGreaterThan(0);
    // The presigned PUT bypasses the API key and uses the absolute URL.
    expect(fetchMock.mock.calls[2][1].method).toBe('PUT');
    expect(JSON.parse(fetchMock.mock.calls[3][1].body as string)).toEqual({ job_id: 'upl_1', file_ids: ['file_1'] });
  });

  it('ingestFilesystem walks a directory and uploads matching files', async () => {
    const root = join(tmpdir(), `vectoramp-sdk-fs-${Date.now()}`);
    await mkdir(join(root, 'nested'), { recursive: true });
    await writeFile(join(root, 'one.md'), '# One');
    await writeFile(join(root, 'nested', 'two.txt'), 'Two');
    await writeFile(join(root, 'skip.bin'), 'nope');

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: 'src_fs', source_type: 'file_upload' }, { status: 201 }))
      .mockResolvedValueOnce(
        jsonResponse({
          job_id: 'upl_fs',
          uploads: [
            { file_id: 'f1', upload_url: 'https://uploads.example.com/f1' },
            { file_id: 'f2', upload_url: 'https://uploads.example.com/f2' }
          ]
        })
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(jsonResponse({ job_id: 'job_fs', status: 'pending' }));
    const client = new VectorAmp({ apiKey: 'sk', fetch: fetchMock as unknown as typeof fetch });

    await expect(client.datasets.ingestFilesystem('ds', root)).resolves.toMatchObject({ job_id: 'job_fs' });

    // Two matching text files were collected; skip.bin was ignored.
    const initBody = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(initBody.files).toHaveLength(2);
    expect(initBody.files.map((file: { name: string }) => file.name).sort()).toEqual(['one.md', 'two.txt']);
    expect(JSON.parse(fetchMock.mock.calls[4][1].body as string)).toEqual({ job_id: 'upl_fs', file_ids: ['f1', 'f2'] });
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
      // typedWeb inline ingest: create source, then start the job
      .mockResolvedValueOnce(jsonResponse({ id: 'src_inline', source_type: 'web' }, { status: 201 }))
      .mockResolvedValueOnce(jsonResponse({ id: 'job_inline' }));
    const client = new VectorAmp({ apiKey: 'sk', fetch: fetchMock as unknown as typeof fetch });

    const typedWeb = webSource({ url: 'https://example.com/docs', config: { maxDepth: 2 } }) satisfies SourceCreateInput;
    expect(s3Source('s3://bucket/docs')).toEqual({ source_type: 's3', uri: 's3://bucket/docs' });
    expect(gcsSource({ bucket: 'docs-bucket', prefix: 'docs/' })).toEqual({ source_type: 'gcs', bucket: 'docs-bucket', prefix: 'docs/' });
    expect(googleDriveSource({ folderId: 'folder_1' })).toEqual({ source_type: 'gdrive', folderId: 'folder_1' });
    expect(fileUploadSource({ fileIds: ['file_1'] })).toEqual({ source_type: 'file_upload', name: 'Local file upload', fileIds: ['file_1'] });
    expect(jiraSource({ cloudId: 'cloud_1', projectKeys: ['ENG'] })).toEqual({ source_type: 'jira', includeComments: true, cloudId: 'cloud_1', projectKeys: ['ENG'] });
    // Confluence helper is present and stamps the confluence source_type.
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
      'https://api.vectoramp.com/ingestion/sources',
      'https://api.vectoramp.com/ingestion/sources',
      'https://api.vectoramp.com/ingestion/sources',
      'https://api.vectoramp.com/ingestion/sources',
      'https://api.vectoramp.com/ingestion/sources',
      'https://api.vectoramp.com/ingestion/sources',
      'https://api.vectoramp.com/ingestion/sources',
      'https://api.vectoramp.com/ingestion/sources',
      'https://api.vectoramp.com/ingestion/jobs'
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
    // typedWeb -> create web source, then start the job
    expect(JSON.parse(fetchMock.mock.calls[7][1].body as string)).toEqual({
      source_type: 'web',
      uri: 'https://example.com/docs',
      config: { max_depth: 2 }
    });
    expect(JSON.parse(fetchMock.mock.calls[8][1].body as string)).toEqual({ source_id: 'src_inline', dataset_id: 'ds' });
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

    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({ query: 'What is VectorAmp?' });
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.vectoramp.com/intelligence/query');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body as string)).toEqual({ question: 'stream me', dataset_id: 'ds', stream: true });
    expect(events).toEqual([{ event: 'delta', data: { token: 'hi' } }, { data: 'plain' }]);
  });


  it('supports Intelligence sessions and messages', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: 'sess_1', title: 'Planning' }, { status: 201 }))
      .mockResolvedValueOnce(jsonResponse({ sessions: [{ id: 'sess_1' }] }))
      .mockResolvedValueOnce(jsonResponse({ id: 'sess_1', title: 'Planning' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'msg_1', role: 'user', content: 'hello' }, { status: 201 }))
      .mockResolvedValueOnce(jsonResponse({ messages: [{ id: 'msg_1', role: 'user', content: 'hello' }] }))
      .mockResolvedValueOnce(jsonResponse(null, { status: 204 }));
    const client = new VectorAmp({ apiKey: 'sk', fetch: fetchMock as unknown as typeof fetch });

    await expect(client.intelligence.createSession({ title: 'Planning', workspaceId: 'ws_1', datasetId: 'ds_1', metadata: { team: 'eng' } })).resolves.toMatchObject({ id: 'sess_1' });
    await expect(client.intelligence.listSessions({ limit: 25 })).resolves.toEqual({ sessions: [{ id: 'sess_1' }] });
    await expect(client.intelligence.getSession('sess/1')).resolves.toMatchObject({ id: 'sess_1' });
    await expect(client.intelligence.appendMessage('sess/1', { role: 'user', content: 'hello', metadata: { turn: 1 } })).resolves.toMatchObject({ id: 'msg_1' });
    await expect(client.intelligence.listMessages('sess/1', { limit: 50 })).resolves.toEqual({ messages: [{ id: 'msg_1', role: 'user', content: 'hello' }] });
    await expect(client.intelligence.deleteSession('sess/1')).resolves.toBeUndefined();

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      'https://api.vectoramp.com/intelligence/sessions',
      'https://api.vectoramp.com/intelligence/sessions?limit=25',
      'https://api.vectoramp.com/intelligence/sessions/sess%2F1',
      'https://api.vectoramp.com/intelligence/sessions/sess%2F1/messages',
      'https://api.vectoramp.com/intelligence/sessions/sess%2F1/messages?limit=50',
      'https://api.vectoramp.com/intelligence/sessions/sess%2F1'
    ]);
    expect(fetchMock.mock.calls[5][1].method).toBe('DELETE');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({ title: 'Planning', workspace_id: 'ws_1', dataset_id: 'ds_1', metadata: { team: 'eng' } });
    expect(JSON.parse(fetchMock.mock.calls[3][1].body as string)).toEqual({ role: 'user', content: 'hello', metadata: { turn: 1 } });
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

  it('exposes ingestion schedules with the full CRUD + trigger surface', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          schedules: [{ id: 'sch_1', cron: '0 * * * *', enabled: true }],
          total: 1,
          limit: 10,
          offset: 0
        })
      )
      .mockResolvedValueOnce(jsonResponse({ id: 'sch_1', cron: '0 * * * *' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'sch_2', cron: '0 0 * * *' }, { status: 201 }))
      .mockResolvedValueOnce(jsonResponse({ id: 'sch_2', cron: '0 0 * * *', enabled: false }))
      .mockResolvedValueOnce(jsonResponse({ deleted: true }, { status: 200 }))
      .mockResolvedValueOnce(jsonResponse({ jobId: 'job_42' }, { status: 202 }));

    const client = new VectorAmp({ apiKey: 'sk', fetch: fetchMock as unknown as typeof fetch });

    const page = await client.schedules.list({ limit: 10, offset: 0 });
    expect(page).toMatchObject({ total: 1, limit: 10, offset: 0 });
    expect(page.data).toEqual([{ id: 'sch_1', cron: '0 * * * *', enabled: true }]);

    await expect(client.schedules.get('sch_1')).resolves.toMatchObject({ id: 'sch_1' });

    const created = await client.schedules.create({
      sourceId: 'src_1',
      datasetId: 'ds_1',
      cron: '0 0 * * *',
      timezone: 'UTC'
    });
    expect(created).toMatchObject({ id: 'sch_2' });
    const createBody = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[2][1].body as string;
    expect(JSON.parse(createBody)).toEqual({
      source_id: 'src_1',
      dataset_id: 'ds_1',
      cron: '0 0 * * *',
      timezone: 'UTC'
    });

    await expect(client.schedules.update('sch_2', { enabled: false })).resolves.toMatchObject({ enabled: false });
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      'https://api.vectoramp.com/ingestion/schedules/sch_2',
      expect.objectContaining({ method: 'PATCH' })
    );

    await expect(client.schedules.delete('sch_2')).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenNthCalledWith(
      5,
      'https://api.vectoramp.com/ingestion/schedules/sch_2',
      expect.objectContaining({ method: 'DELETE' })
    );

    await expect(client.schedules.trigger('sch_1')).resolves.toEqual({ jobId: 'job_42' });
    expect(fetchMock).toHaveBeenNthCalledWith(
      6,
      'https://api.vectoramp.com/ingestion/schedules/sch_1/trigger',
      expect.objectContaining({ method: 'POST' })
    );
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
