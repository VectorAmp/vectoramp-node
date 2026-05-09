import type { IngestionJob, Transport } from './types.js';

/** Ingestion job management API client. */
export class IngestionClient {
  constructor(private readonly transport: Transport) {}

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
