import { DatasetsClient } from './datasets.js';
import { IntelligenceClient } from './intelligence.js';
import { RestTransport } from './transport.js';
import type { AskRequest, AskResponse, StreamEvent, Transport, VectorAmpClientOptions } from './types.js';

const DEFAULT_BASE_URL = 'https://api.vectoramp.com';
const DEFAULT_API_PREFIX = '/api/v1';

export class VectorAmpClient {
  readonly datasets: DatasetsClient;
  readonly intelligence: IntelligenceClient;
  readonly transport: Transport;

  constructor(options: VectorAmpClientOptions = {}) {
    this.transport = options.transport ?? new RestTransport({
      apiKey: options.apiKey ?? process.env.VECTORAMP_API_KEY,
      baseUrl: options.baseUrl ?? DEFAULT_BASE_URL,
      apiPrefix: options.apiPrefix ?? DEFAULT_API_PREFIX,
      fetch: options.fetch,
      headers: options.headers
    });

    this.intelligence = new IntelligenceClient(this.transport);
    this.datasets = new DatasetsClient(this.transport, { client: this });
  }

  ask(request: string | AskRequest): Promise<AskResponse> {
    return this.intelligence.ask(request);
  }

  askStream(request: string | AskRequest): AsyncIterable<StreamEvent> {
    return this.intelligence.askStream(request);
  }
}

export function createClient(options: VectorAmpClientOptions = {}): VectorAmpClient {
  return new VectorAmpClient(options);
}

export { DEFAULT_API_PREFIX, DEFAULT_BASE_URL };
