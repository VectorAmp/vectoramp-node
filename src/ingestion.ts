import type {
  IngestionJob,
  IngestionSource,
  Page,
  PaginationParams,
  Transport
} from './types.js';
import { normalizePage, toSnakeCasePayload } from './utils.js';

/** Request to start an ingestion job from a source. */
export interface StartJobRequest {
  /** Source id to ingest from. */
  sourceId: string;
  /** Dataset id to ingest into. */
  datasetId: string;
  /** Optional pipeline id. Omit to use the default ingestion pipeline. */
  pipelineId?: string;
  /** Additional API fields. */
  [key: string]: unknown;
}

/** Optional filters for listing ingestion jobs. */
export interface ListJobsParams extends PaginationParams {
  /** Restrict to jobs for a single dataset. */
  datasetId?: string;
}

/** Ingestion job management API client. */
export class IngestionClient {
  constructor(private readonly transport: Transport) {}

  /**
   * List ingestion sources for the current organization.
   *
   * @param params - Optional pagination params (`limit`, `offset`).
   * @returns A page of ingestion sources.
   */
  async listSources(params: PaginationParams = {}): Promise<Page<IngestionSource>> {
    const payload = await this.transport.request<unknown>('GET', '/ingestion/sources', { query: { ...params } });
    return normalizePage<IngestionSource>(payload, params, 'sources');
  }

  /**
   * Fetch one ingestion source by id.
   *
   * @param sourceId - Source id.
   * @returns The ingestion source.
   */
  getSource(sourceId: string): Promise<IngestionSource> {
    return this.transport.request<IngestionSource>('GET', `/ingestion/sources/${encodeURIComponent(sourceId)}`);
  }

  /**
   * Start an ingestion job from an existing source.
   *
   * @param request - Source id, dataset id, and optional pipeline id.
   * @returns The created ingestion job.
   */
  startJob(request: StartJobRequest): Promise<IngestionJob> {
    return this.transport.request<IngestionJob>('POST', '/ingestion/jobs', { body: toSnakeCasePayload(request) });
  }

  /**
   * List ingestion jobs.
   *
   * @param params - Optional `datasetId` filter and pagination params.
   * @returns A page of ingestion jobs.
   */
  async listJobs(params: ListJobsParams = {}): Promise<Page<IngestionJob>> {
    const { datasetId, ...pagination } = params;
    const query = { ...pagination, dataset_id: datasetId };
    const payload = await this.transport.request<unknown>('GET', '/ingestion/jobs', { query });
    return normalizePage<IngestionJob>(payload, pagination, 'jobs');
  }

  /**
   * Fetch one ingestion job by id.
   *
   * @param jobId - Job id.
   * @returns The ingestion job.
   */
  getJob(jobId: string): Promise<IngestionJob> {
    return this.transport.request<IngestionJob>('GET', `/ingestion/jobs/${encodeURIComponent(jobId)}`);
  }

  /**
   * Retry an eligible failed or cancelled ingestion job as a fresh full rerun.
   *
   * @param jobId - Original ingestion job id.
   * @returns The newly queued retry job.
   */
  retryJob(jobId: string): Promise<IngestionJob> {
    return this.transport.request<IngestionJob>('POST', `/ingestion/jobs/${encodeURIComponent(jobId)}/retry`);
  }
}
