import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  VectorAmp,
  confluenceSource,
  gcsSource,
  googleDriveSource,
  jiraSource,
  type Connection,
  type RequestOptions,
  type Transport
} from '../index.js';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const status = init.status ?? 200;
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...(init.headers as Record<string, string> | undefined) }
  });
}

/** Records every transport call and returns queued responses in order. */
function recordingTransport(responses: unknown[]): {
  transport: Transport;
  calls: Array<[string, string, RequestOptions | undefined]>;
} {
  const calls: Array<[string, string, RequestOptions | undefined]> = [];
  let index = 0;
  const transport: Transport = {
    async request<T>(method: string, path: string, options?: RequestOptions): Promise<T> {
      calls.push([method, path, options]);
      return (responses[index++]) as T;
    }
  };
  return { transport, calls };
}

describe('SourcesClient source management', () => {
  afterEach(() => vi.restoreAllMocks());

  it('deletes a source and forwards ?force=true only when requested', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const client = new VectorAmp({ apiKey: 'sk', fetch: fetchMock as unknown as typeof fetch });

    await expect(client.sources.delete('src_1')).resolves.toBeUndefined();
    await expect(client.sources.delete('src_2', { force: true })).resolves.toBeUndefined();

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      'https://api.vectoramp.com/ingestion/sources/src_1',
      'https://api.vectoramp.com/ingestion/sources/src_2?force=true'
    ]);
    expect(fetchMock.mock.calls[0][1].method).toBe('DELETE');
    expect(fetchMock.mock.calls[1][1].method).toBe('DELETE');
  });

  it('lists unused sources as a normalized page', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ sources: [{ id: 'src_unused' }], total: 1 }));
    const client = new VectorAmp({ apiKey: 'sk', fetch: fetchMock as unknown as typeof fetch });

    const page = await client.sources.listUnused({ limit: 5, offset: 10 });

    expect(page).toMatchObject({ total: 1, limit: 5, offset: 10 });
    expect(page.data).toEqual([{ id: 'src_unused' }]);
    const calls = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0][0]).toBe('https://api.vectoramp.com/ingestion/sources/unused?limit=5&offset=10');
    expect(calls[0][1].method).toBe('GET');
  });

  it('cleans up unused sources', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ deleted: [{ id: 'src_a', name: 'Old web', type: 'web' }], count: 1 })
    );
    const client = new VectorAmp({ apiKey: 'sk', fetch: fetchMock as unknown as typeof fetch });

    await expect(client.sources.cleanupUnused()).resolves.toEqual({
      deleted: [{ id: 'src_a', name: 'Old web', type: 'web' }],
      count: 1
    });
    const calls = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0][0]).toBe('https://api.vectoramp.com/ingestion/sources/cleanup');
    expect(calls[0][1].method).toBe('POST');
  });

  it('fetches the references for a source', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ jobs: ['job_1'], schedules: [], datasets: ['ds_1'] }));
    const client = new VectorAmp({ apiKey: 'sk', fetch: fetchMock as unknown as typeof fetch });

    await expect(client.sources.getReferences('src_1')).resolves.toEqual({
      jobs: ['job_1'],
      schedules: [],
      datasets: ['ds_1']
    });
    const calls = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0][0]).toBe('https://api.vectoramp.com/ingestion/sources/src_1/references');
    expect(calls[0][1].method).toBe('GET');
  });

  it('validates a source config and snake_cases the body', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ valid: true }));
    const client = new VectorAmp({ apiKey: 'sk', fetch: fetchMock as unknown as typeof fetch });

    await expect(
      client.sources.validate('gdrive', { folderIds: ['folder_1'], authMode: 'oauth' })
    ).resolves.toEqual({ valid: true });

    const calls = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0][0]).toBe('https://api.vectoramp.com/ingestion/sources/validate');
    expect(calls[0][1].method).toBe('POST');
    expect(JSON.parse(calls[0][1].body as string)).toEqual({
      source_type: 'gdrive',
      config: { folder_ids: ['folder_1'], auth_mode: 'oauth' }
    });
  });
});

describe('Typed OAuth source builders', () => {
  afterEach(() => vi.restoreAllMocks());

  it('googleDriveSource serializes typed OAuth/connection fields into config (snake_case)', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ id: 'src_gdrive', source_type: 'gdrive' }, { status: 201 }));
    const client = new VectorAmp({ apiKey: 'sk', fetch: fetchMock as unknown as typeof fetch });

    await client.sources.createGoogleDrive({
      folderId: 'folder_1',
      authMode: 'service_account',
      serviceAccountJson: '{"type":"service_account"}',
      connectionId: 'conn_99',
      config: { syncMode: 'incremental' }
    });

    const calls = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(JSON.parse(calls[0][1].body as string)).toEqual({
      source_type: 'gdrive',
      folder_id: 'folder_1',
      config: {
        sync_mode: 'incremental',
        auth_mode: 'service_account',
        service_account_json: '{"type":"service_account"}',
        connection_id: 'conn_99'
      }
    });
  });

  it('googleDriveSource serializes an oauth_credentials object into config', () => {
    expect(
      googleDriveSource({ folderId: 'f1', oauthCredentials: { accessToken: 'tok' } })
    ).toEqual({
      source_type: 'gdrive',
      folderId: 'f1',
      config: { oauth_credentials: { accessToken: 'tok' } }
    });
  });

  it('maps connection/connectionId to config.connection_id for gcs, jira, and confluence', () => {
    expect(gcsSource({ bucket: 'b', connection: 'conn_g' })).toEqual({
      source_type: 'gcs',
      bucket: 'b',
      config: { connection_id: 'conn_g' }
    });
    expect(jiraSource({ cloudId: 'c', connectionId: 'conn_j' })).toEqual({
      source_type: 'jira',
      includeComments: true,
      cloudId: 'c',
      config: { connection_id: 'conn_j' }
    });
    expect(confluenceSource({ cloudId: 'c', connection: 'conn_c', config: { spaces: ['DOCS'] } })).toEqual({
      source_type: 'confluence',
      cloudId: 'c',
      config: { spaces: ['DOCS'], connection_id: 'conn_c' }
    });
  });

  it('leaves builders untouched when no connection/OAuth fields are passed', () => {
    expect(googleDriveSource({ folderId: 'folder_1' })).toEqual({ source_type: 'gdrive', folderId: 'folder_1' });
    expect(gcsSource({ bucket: 'docs-bucket', prefix: 'docs/' })).toEqual({
      source_type: 'gcs',
      bucket: 'docs-bucket',
      prefix: 'docs/'
    });
  });
});

describe('ConnectionsClient', () => {
  afterEach(() => vi.restoreAllMocks());

  it('lists connections, unwraps the { connections, total } envelope, and forwards the provider filter', async () => {
    const { transport, calls } = recordingTransport([
      { connections: [{ id: 'conn_1', provider: 'google' }], total: 1 }
    ]);
    const client = new VectorAmp({ transport });

    const page = await client.connections.list({ provider: 'google' });

    expect(page.data).toEqual([{ id: 'conn_1', provider: 'google' }]);
    expect(page.total).toBe(1);

    expect(calls[0][0]).toBe('GET');
    expect(calls[0][1]).toBe('/connections');
    expect(calls[0][2]).toEqual({ query: { provider: 'google' } });
  });

  it('creates a connection with and without a source type', async () => {
    const { transport, calls } = recordingTransport([
      { id: 'conn_1', provider: 'google', status: 'pending' },
      { id: 'conn_2', provider: 'atlassian', status: 'pending' }
    ]);
    const client = new VectorAmp({ transport });

    await client.connections.create('google', { sourceType: 'gdrive' });
    await client.connections.create('atlassian');

    expect(calls[0]).toEqual(['POST', '/connections', { body: { provider: 'google', source_type: 'gdrive' } }]);
    expect(calls[1]).toEqual(['POST', '/connections', { body: { provider: 'atlassian' } }]);
  });

  it('gets and deletes a connection', async () => {
    const { transport, calls } = recordingTransport([{ id: 'conn_1', status: 'connected' }, undefined]);
    const client = new VectorAmp({ transport });

    await expect(client.connections.get('conn/1')).resolves.toMatchObject({ id: 'conn_1' });
    await expect(client.connections.delete('conn/1')).resolves.toBeUndefined();

    expect(calls[0]).toEqual(['GET', '/connections/conn%2F1', undefined]);
    expect(calls[1]).toEqual(['DELETE', '/connections/conn%2F1', undefined]);
  });

  it('connect() creates, surfaces the URL, and polls until connected', async () => {
    const { transport, calls } = recordingTransport([
      { id: 'conn_1', provider: 'google', status: 'pending', authorization_url: 'https://auth.example/go' },
      { id: 'conn_1', status: 'pending' },
      { id: 'conn_1', status: 'connected' }
    ]);
    const client = new VectorAmp({ transport });
    const urls: string[] = [];

    const connection = await client.connections.connect('google', {
      sourceType: 'gdrive',
      onUrl: (url) => urls.push(url),
      pollIntervalMs: 1
    });

    expect(connection).toMatchObject({ status: 'connected' });
    expect(urls).toEqual(['https://auth.example/go']);
    expect(calls.map((call) => `${call[0]} ${call[1]}`)).toEqual([
      'POST /connections',
      'GET /connections/conn_1',
      'GET /connections/conn_1'
    ]);
    expect(calls[0][2]).toEqual({ body: { provider: 'google', source_type: 'gdrive' } });
  });

  it('connect() logs the authorization URL by default and accepts the camelCase alias', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { transport } = recordingTransport([
      { id: 'conn_2', status: 'pending', authorizationUrl: 'https://auth.example/cc' },
      { id: 'conn_2', status: 'connected' }
    ]);
    const client = new VectorAmp({ transport });

    await expect(client.connections.connect('atlassian')).resolves.toMatchObject({ status: 'connected' });
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0][0]).toContain('https://auth.example/cc');
  });

  it('connect() throws when no connection id is returned', async () => {
    const { transport } = recordingTransport([{ status: 'pending' } satisfies Connection]);
    const client = new VectorAmp({ transport });

    await expect(client.connections.connect('google')).rejects.toThrow(/did not return a connection id/);
  });

  it('connect() times out when the connection never reaches connected', async () => {
    const { transport } = recordingTransport([
      { id: 'conn_3', status: 'pending' },
      { id: 'conn_3', status: 'pending' }
    ]);
    const client = new VectorAmp({ transport });

    await expect(client.connections.connect('google', { timeoutMs: 0 })).rejects.toThrow(/Timed out/);
  });
});
