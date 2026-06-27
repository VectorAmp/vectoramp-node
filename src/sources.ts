import type {
  CleanupUnusedResponse,
  ConfluenceSourceOptions,
  DeleteSourceOptions,
  FileUploadSourceOptions,
  GcsSourceOptions,
  GoogleDriveSourceOptions,
  IngestionJob,
  IngestionSource,
  IngestionSourceInput,
  JsonObject,
  JiraSourceOptions,
  Page,
  PaginationParams,
  S3SourceOptions,
  SourceCreateInput,
  SourceReferences,
  SourceType,
  SourceValidationResult,
  Transport,
  WebSourceOptions
} from './types.js';
import { IngestionClient, type ListJobsParams, type StartJobRequest } from './ingestion.js';
import { normalizePage, toSnakeCasePayload } from './utils.js';

/**
 * Merge typed OAuth/connection fields into a source `config`, dropping `undefined`
 * values. Returns the original config (possibly `undefined`) when there is nothing
 * to add so existing builder output is preserved byte-for-byte.
 */
function withSourceConfig(existing: JsonObject | undefined, additions: Record<string, unknown>): JsonObject | undefined {
  const defined = Object.fromEntries(Object.entries(additions).filter(([, value]) => value !== undefined));
  if (Object.keys(defined).length === 0) return existing;
  return { ...(existing ?? {}), ...defined };
}

/**
 * Build a web ingestion source payload.
 *
 * @param input - URL string or web source options. `url` is accepted as an alias for `uri`.
 * @returns Source creation input with `source_type: "web"`.
 */
export function webSource(input: string | WebSourceOptions): IngestionSourceInput {
  if (typeof input === 'string') return { source_type: 'web', uri: input };
  const { url, uri = url, ...rest } = input;
  return { ...rest, source_type: 'web', uri };
}

/**
 * Build an S3 ingestion source payload.
 *
 * @param input - S3 URI string or S3 source options.
 * @returns Source creation input with `source_type: "s3"`.
 */
export function s3Source(input: string | S3SourceOptions): IngestionSourceInput {
  if (typeof input === 'string') return { source_type: 's3', uri: input };
  return { ...input, source_type: 's3' };
}

/**
 * Build a Google Cloud Storage ingestion source payload.
 *
 * @param input - GCS URI string or GCS source options.
 * @returns Source creation input with `source_type: "gcs"`.
 */
export function gcsSource(input: string | GcsSourceOptions): IngestionSourceInput {
  if (typeof input === 'string') return { source_type: 'gcs', uri: input };
  const { connection, connectionId, config, ...rest } = input;
  const mergedConfig = withSourceConfig(config, { connection_id: connectionId ?? connection });
  return { ...rest, source_type: 'gcs', ...(mergedConfig ? { config: mergedConfig } : {}) };
}

/**
 * Build a Google Drive ingestion source payload.
 *
 * @param input - Drive URI/id string or Google Drive source options.
 * @returns Source creation input with `source_type: "gdrive"`.
 */
export function googleDriveSource(input: string | GoogleDriveSourceOptions): IngestionSourceInput {
  if (typeof input === 'string') return { source_type: 'gdrive', uri: input };
  const { authMode, serviceAccountJson, oauthCredentials, connection, connectionId, config, ...rest } = input;
  const mergedConfig = withSourceConfig(config, {
    auth_mode: authMode,
    service_account_json: serviceAccountJson,
    oauth_credentials: oauthCredentials,
    connection_id: connectionId ?? connection
  });
  return { ...rest, source_type: 'gdrive', ...(mergedConfig ? { config: mergedConfig } : {}) };
}

/**
 * Build a local file-upload ingestion source payload.
 *
 * @param input - File upload source options. `name` defaults to `Local file upload`.
 * @returns Source creation input with `source_type: "file_upload"`.
 */
export function fileUploadSource(input: FileUploadSourceOptions = {}): IngestionSourceInput {
  return { name: 'Local file upload', ...input, source_type: 'file_upload' };
}

/**
 * Build a Jira ingestion source payload.
 *
 * @param input - Jira source options, usually populated from the Atlassian browser OAuth flow.
 * @returns Source creation input with `source_type: "jira"`.
 */
export function jiraSource(input: JiraSourceOptions): IngestionSourceInput {
  const { connection, connectionId, config, ...rest } = input;
  const mergedConfig = withSourceConfig(config, { connection_id: connectionId ?? connection });
  return { includeComments: true, ...rest, source_type: 'jira', ...(mergedConfig ? { config: mergedConfig } : {}) };
}

/**
 * Build a Confluence ingestion source payload.
 *
 * @param input - Confluence source options, usually populated from the Atlassian browser OAuth flow.
 * @returns Source creation input with `source_type: "confluence"`.
 */
export function confluenceSource(input: ConfluenceSourceOptions): IngestionSourceInput {
  const { connection, connectionId, config, ...rest } = input;
  const mergedConfig = withSourceConfig(config, { connection_id: connectionId ?? connection });
  return { ...rest, source_type: 'confluence', ...(mergedConfig ? { config: mergedConfig } : {}) };
}

/**
 * Build a source payload for any supported or custom source type.
 *
 * @param sourceType - Source type string.
 * @param input - Source properties to include.
 * @returns Source creation input with the requested `source_type`.
 */
export function genericSource(sourceType: SourceType | (string & {}), input: Record<string, unknown> = {}): IngestionSourceInput {
  return { ...input, source_type: sourceType };
}

/**
 * Ingestion source creation API client.
 *
 * Exposed as both `client.sources` and `client.ingestion`. In addition to source
 * creation helpers, it surfaces source listing/get and the ingestion job
 * lifecycle (`startJob`, `listJobs`, `getJob`, `retryJob`) for a single
 * ingestion entry point.
 */
export class SourcesClient {
  private readonly jobs: IngestionClient;

  constructor(private readonly transport: Transport) {
    this.jobs = new IngestionClient(transport);
  }

  /**
   * Create an ingestion source.
   *
   * @param request - Source creation payload.
   * @returns The created source.
   */
  create(request: SourceCreateInput): Promise<IngestionSource> {
    return this.transport.request<IngestionSource>('POST', '/ingestion/sources', {
      body: toSnakeCasePayload(request)
    });
  }

  /**
   * List ingestion sources for the current organization.
   *
   * @param params - Optional pagination params (`limit`, `offset`).
   * @returns A page of ingestion sources.
   */
  list(params: PaginationParams = {}): Promise<Page<IngestionSource>> {
    return this.jobs.listSources(params);
  }

  /**
   * Fetch one ingestion source by id.
   *
   * @param sourceId - Source id.
   * @returns The ingestion source.
   */
  get(sourceId: string): Promise<IngestionSource> {
    return this.jobs.getSource(sourceId);
  }

  /**
   * Delete an ingestion source.
   *
   * @param sourceId - Source id.
   * @param opts - Set `force: true` to delete even when the source is still referenced.
   * @returns Resolves when the API accepts the deletion.
   */
  async delete(sourceId: string, opts: DeleteSourceOptions = {}): Promise<void> {
    await this.transport.request<unknown>('DELETE', `/ingestion/sources/${encodeURIComponent(sourceId)}`, {
      query: opts.force ? { force: true } : undefined
    });
  }

  /**
   * List ingestion sources that are not referenced by any job or schedule.
   *
   * @param opts - Optional pagination params (`limit`, `offset`).
   * @returns A page of unused ingestion sources.
   */
  async listUnused(opts: PaginationParams = {}): Promise<Page<IngestionSource>> {
    const payload = await this.transport.request<unknown>('GET', '/ingestion/sources/unused', { query: { ...opts } });
    return normalizePage<IngestionSource>(payload, opts, 'sources');
  }

  /**
   * Delete all unused ingestion sources for the current organization.
   *
   * @returns The deleted sources and a count.
   */
  cleanupUnused(): Promise<CleanupUnusedResponse> {
    return this.transport.request<CleanupUnusedResponse>('POST', '/ingestion/sources/cleanup');
  }

  /**
   * List the jobs, schedules, and datasets that reference a source.
   *
   * @param sourceId - Source id.
   * @returns The source's references.
   */
  getReferences(sourceId: string): Promise<SourceReferences> {
    return this.transport.request<SourceReferences>('GET', `/ingestion/sources/${encodeURIComponent(sourceId)}/references`);
  }

  /**
   * Validate an ingestion source config without creating the source.
   *
   * @param sourceType - Source type to validate against.
   * @param config - Provider-specific configuration to validate.
   * @returns The validation result.
   */
  validate(sourceType: SourceType | (string & {}), config: JsonObject): Promise<SourceValidationResult> {
    return this.transport.request<SourceValidationResult>('POST', '/ingestion/sources/validate', {
      body: toSnakeCasePayload({ sourceType, config })
    });
  }

  /**
   * Start an ingestion job from an existing source.
   *
   * @param request - Source id, dataset id, and optional pipeline id.
   * @returns The created ingestion job.
   */
  startJob(request: StartJobRequest): Promise<IngestionJob> {
    return this.jobs.startJob(request);
  }

  /**
   * List ingestion jobs.
   *
   * @param params - Optional `datasetId` filter and pagination params.
   * @returns A page of ingestion jobs.
   */
  listJobs(params: ListJobsParams = {}): Promise<Page<IngestionJob>> {
    return this.jobs.listJobs(params);
  }

  /**
   * Fetch one ingestion job by id.
   *
   * @param jobId - Job id.
   * @returns The ingestion job.
   */
  getJob(jobId: string): Promise<IngestionJob> {
    return this.jobs.getJob(jobId);
  }

  /**
   * Retry an eligible failed or cancelled ingestion job.
   *
   * @param jobId - Original ingestion job id.
   * @returns The newly queued retry job.
   */
  retryJob(jobId: string): Promise<IngestionJob> {
    return this.jobs.retryJob(jobId);
  }

  /**
   * Create a web ingestion source.
   *
   * @param input - URL string or web source options.
   * @returns The created source.
   */
  createWeb(input: string | WebSourceOptions): Promise<IngestionSource> {
    return this.create(webSource(input));
  }

  /**
   * Create an S3 ingestion source.
   *
   * @param input - S3 URI string or S3 source options.
   * @returns The created source.
   */
  createS3(input: string | S3SourceOptions): Promise<IngestionSource> {
    return this.create(s3Source(input));
  }

  /**
   * Create a Google Cloud Storage ingestion source.
   *
   * @param input - GCS URI string or GCS source options.
   * @returns The created source.
   */
  createGcs(input: string | GcsSourceOptions): Promise<IngestionSource> {
    return this.create(gcsSource(input));
  }

  /**
   * Create a Google Drive ingestion source.
   *
   * @param input - Drive URI/id string or Google Drive source options.
   * @returns The created source.
   */
  createGoogleDrive(input: string | GoogleDriveSourceOptions): Promise<IngestionSource> {
    return this.create(googleDriveSource(input));
  }

  /**
   * Create a local file-upload ingestion source.
   *
   * @param input - File upload source options. `name` defaults to `Local file upload`.
   * @returns The created source.
   */
  createFileUpload(input: FileUploadSourceOptions = {}): Promise<IngestionSource> {
    return this.create(fileUploadSource(input));
  }

  /**
   * Create a Jira ingestion source.
   *
   * @param input - Jira source options.
   * @returns The created source.
   */
  createJira(input: JiraSourceOptions): Promise<IngestionSource> {
    return this.create(jiraSource(input));
  }

  /**
   * Create a Confluence ingestion source.
   *
   * @param input - Confluence source options.
   * @returns The created source.
   */
  createConfluence(input: ConfluenceSourceOptions): Promise<IngestionSource> {
    return this.create(confluenceSource(input));
  }
}
