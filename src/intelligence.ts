import type { AskRequest, AskResponse, StreamEvent, Transport } from './types.js';
import { toSnakeCasePayload } from './utils.js';

export class IntelligenceClient {
  constructor(private readonly transport: Transport) {}

  ask(request: string | AskRequest): Promise<AskResponse> {
    const body = typeof request === 'string' ? { question: request } : request;
    return this.transport.request<AskResponse>('POST', '/intelligence/query', { body: toSnakeCasePayload(body) });
  }

  async *askStream(request: string | AskRequest): AsyncIterable<StreamEvent> {
    if (!this.transport.stream) {
      throw new Error('Configured transport does not support streaming responses.');
    }

    const body = typeof request === 'string' ? { question: request, stream: true } : { ...request, stream: true };
    yield* this.transport.stream('POST', '/intelligence/query/stream', { body: toSnakeCasePayload(body) }) as AsyncIterable<StreamEvent>;
  }
}
