import { DatasetsClient } from './datasets.js';
import { IntelligenceClient } from './intelligence.js';
import { IngestionClient } from './ingestion.js';
import { SchedulesClient } from './schedules.js';
import { SourcesClient } from './sources.js';
import { RestTransport } from './transport.js';
import type { AskRequest, AskResponse, StreamEvent, Transport, VectorAmpClientOptions } from './types.js';

/** Default VectorAmp API origin. */
const DEFAULT_BASE_URL = 'https://api.vectoramp.com';
/** Default VectorAmp API prefix. The public gateway serves unprefixed paths. */
const DEFAULT_API_PREFIX = '';

/** Primary entry point for the VectorAmp Node SDK. */
export class VectorAmpClient {
  /** Dataset management and vector search helpers. */
  readonly datasets: DatasetsClient;
  /** Natural-language intelligence/query helpers. */
  readonly intelligence: IntelligenceClient;
  /** Ingestion source creation helpers. */
  readonly sources: SourcesClient;
  /** Ingestion job management helpers. */
  readonly ingestion: IngestionClient;
  /** Ingestion schedule management helpers. */
  readonly schedules: SchedulesClient;
  /** Transport used by all sub-clients. */
  readonly transport: Transport;

  /**
   * Create a VectorAmp client.
   *
   * @param options - Client configuration. Defaults to `https://api.vectoramp.com` and `VECTORAMP_API_KEY`.
   */
  constructor(options: VectorAmpClientOptions = {}) {
    this.transport = options.transport ?? new RestTransport({
      apiKey: options.apiKey ?? process.env.VECTORAMP_API_KEY,
      baseUrl: options.baseUrl ?? DEFAULT_BASE_URL,
      apiPrefix: options.apiPrefix ?? DEFAULT_API_PREFIX,
      fetch: options.fetch,
      headers: options.headers
    });

    this.intelligence = new IntelligenceClient(this.transport);
    this.sources = new SourcesClient(this.transport);
    this.ingestion = new IngestionClient(this.transport);
    this.schedules = new SchedulesClient(this.transport);
    this.datasets = new DatasetsClient(this.transport, { client: this });
  }

  /**
   * Ask VectorAmp Intelligence a question.
   *
   * @param request - Question string or full ask request. A string becomes `{ query }`.
   * @returns The generated answer and citations returned by the API.
   */
  ask(request: string | AskRequest): Promise<AskResponse> {
    return this.intelligence.ask(request);
  }

  /**
   * Stream a VectorAmp Intelligence answer as server-sent events.
   *
   * @param request - Question string or full ask request. `stream` is forced to `true`.
   * @returns An async iterable of stream events.
   */
  askStream(request: string | AskRequest): AsyncIterable<StreamEvent> {
    return this.intelligence.askStream(request);
  }
}

/**
 * Create a VectorAmp client.
 *
 * @param options - Client configuration.
 * @returns A configured {@link VectorAmpClient}.
 */
export function createClient(options: VectorAmpClientOptions = {}): VectorAmpClient {
  return new VectorAmpClient(options);
}

export { DEFAULT_API_PREFIX, DEFAULT_BASE_URL };
