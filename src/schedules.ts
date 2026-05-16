import type {
  Page,
  PaginationParams,
  Schedule,
  ScheduleCreateInput,
  ScheduleListResponse,
  ScheduleTriggerResponse,
  ScheduleUpdateInput,
  Transport
} from './types.js';
import { normalizePage, toSnakeCasePayload } from './utils.js';

function schedulePath(id: string): string {
  return `/ingestion/schedules/${encodeURIComponent(id)}`;
}

/** Ingestion schedule management API client. */
export class SchedulesClient {
  constructor(private readonly transport: Transport) {}

  /**
   * List schedules for the current organization.
   *
   * @param params - Optional pagination params (`limit`, `offset`).
   * @returns A page of schedules.
   */
  async list(params: PaginationParams = {}): Promise<Page<Schedule>> {
    const payload = await this.transport.request<ScheduleListResponse | Schedule[]>(
      'GET',
      '/ingestion/schedules',
      { query: { ...params } }
    );
    return normalizePage<Schedule>(payload, params, 'schedules');
  }

  /**
   * Fetch a schedule by id.
   *
   * @param id - Schedule id.
   * @returns The schedule.
   */
  get(id: string): Promise<Schedule> {
    return this.transport.request<Schedule>('GET', schedulePath(id));
  }

  /**
   * Create a schedule.
   *
   * @param request - Schedule creation payload (source id, dataset id, cron, timezone, etc.).
   * @returns The created schedule.
   */
  create(request: ScheduleCreateInput): Promise<Schedule> {
    return this.transport.request<Schedule>('POST', '/ingestion/schedules', {
      body: toSnakeCasePayload(request)
    });
  }

  /**
   * Update a schedule.
   *
   * @param id - Schedule id.
   * @param updates - Partial schedule updates (cron, timezone, enabled, etc.).
   * @returns The updated schedule.
   */
  update(id: string, updates: ScheduleUpdateInput): Promise<Schedule> {
    return this.transport.request<Schedule>('PATCH', schedulePath(id), {
      body: toSnakeCasePayload(updates)
    });
  }

  /**
   * Delete a schedule.
   *
   * @param id - Schedule id.
   */
  async delete(id: string): Promise<void> {
    await this.transport.request<unknown>('DELETE', schedulePath(id));
  }

  /**
   * Trigger an immediate ingestion run for a schedule, outside its normal cadence.
   *
   * @param id - Schedule id.
   * @returns The created run info (typically the new job id).
   */
  trigger(id: string): Promise<ScheduleTriggerResponse> {
    return this.transport.request<ScheduleTriggerResponse>(
      'POST',
      `${schedulePath(id)}/trigger`
    );
  }
}
