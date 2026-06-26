import type {
  Connection,
  ConnectionProvider,
  ConnectOptions,
  CreateConnectionOptions,
  ListConnectionsOptions,
  Transport
} from './types.js';

/** Default poll interval, in milliseconds, used by {@link ConnectionsClient.connect}. */
const DEFAULT_POLL_INTERVAL_MS = 2000;
/** Default overall timeout, in milliseconds, used by {@link ConnectionsClient.connect}. */
const DEFAULT_TIMEOUT_MS = 300000;

function connectionPath(id: string): string {
  return `/connections/${encodeURIComponent(id)}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Managed OAuth connection API client, exposed as `client.connections`.
 *
 * Connections store provider OAuth credentials (Google, Atlassian) so source
 * helpers can reference them via `connection`/`connectionId` instead of inlining
 * tokens. The {@link connect} convenience drives the full browser OAuth handshake.
 */
export class ConnectionsClient {
  constructor(private readonly transport: Transport) {}

  /**
   * List managed OAuth connections.
   *
   * @param opts - Optional `provider` filter (`google` or `atlassian`).
   * @returns The matching connections.
   */
  list(opts: ListConnectionsOptions = {}): Promise<Connection[]> {
    return this.transport.request<Connection[]>('GET', '/connections', {
      query: { provider: opts.provider }
    });
  }

  /**
   * Create a managed OAuth connection and obtain an authorization URL.
   *
   * @param provider - OAuth provider, e.g. `google` or `atlassian`.
   * @param opts - Optional `sourceType` the connection should target (`gdrive` or `gcs`).
   * @returns The created connection, including `status` and the authorization URL.
   */
  create(provider: ConnectionProvider, opts: CreateConnectionOptions = {}): Promise<Connection> {
    const body: Record<string, unknown> = { provider };
    if (opts.sourceType !== undefined) body.source_type = opts.sourceType;
    return this.transport.request<Connection>('POST', '/connections', { body });
  }

  /**
   * Fetch one managed OAuth connection by id.
   *
   * @param id - Connection id.
   * @returns The connection, including its current `status`.
   */
  get(id: string): Promise<Connection> {
    return this.transport.request<Connection>('GET', connectionPath(id));
  }

  /**
   * Delete a managed OAuth connection.
   *
   * @param id - Connection id.
   * @returns Resolves when the API accepts the deletion.
   */
  async delete(id: string): Promise<void> {
    await this.transport.request<unknown>('DELETE', connectionPath(id));
  }

  /**
   * Create a connection and wait for the OAuth handshake to complete.
   *
   * Creates the connection, surfaces the authorization URL (via `onUrl`, or by
   * logging an instruction to stdout by default), then polls {@link get} until the
   * status is `connected` or the timeout elapses.
   *
   * @param provider - OAuth provider, e.g. `google` or `atlassian`.
   * @param opts - Source type, `onUrl` callback, `pollIntervalMs` (2000), and `timeoutMs` (300000).
   * @returns The connected connection.
   */
  async connect(provider: ConnectionProvider, opts: ConnectOptions = {}): Promise<Connection> {
    const { sourceType, onUrl, pollIntervalMs = DEFAULT_POLL_INTERVAL_MS, timeoutMs = DEFAULT_TIMEOUT_MS } = opts;

    const created = await this.create(provider, { sourceType });
    const url = created.authorizationUrl ?? created.authorization_url;
    if (url) {
      if (onUrl) onUrl(url);
      else console.log(`Open this URL to authorize the ${provider} connection, then return here:\n  ${url}`);
    }

    const id = created.id;
    if (!id) throw new Error('VectorAmp API did not return a connection id for connect().');

    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const connection = await this.get(id);
      if (connection.status === 'connected') return connection;
      if (Date.now() >= deadline) {
        throw new Error(
          `Timed out after ${timeoutMs}ms waiting for connection ${id} to connect (last status: ${connection.status ?? 'unknown'}).`
        );
      }
      await delay(pollIntervalMs);
    }
  }
}
