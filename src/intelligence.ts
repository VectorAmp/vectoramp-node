import type { AskRequest, AskResponse, StreamEvent, Transport } from './types.js';
import { toSnakeCasePayload } from './utils.js';

/** Natural-language query API client. */
export class IntelligenceClient {
  constructor(private readonly transport: Transport) {}

  /**
   * Ask VectorAmp Intelligence a question.
   *
   * @param request - Question string or full ask request. A string becomes `{ question }`.
   * @returns The generated answer and citations returned by the API.
   */
  ask(request: string | AskRequest): Promise<AskResponse> {
    const body = typeof request === 'string' ? { question: request } : request;
    return this.transport.request<AskResponse>('POST', '/intelligence/query', { body: toSnakeCasePayload(body) });
  }

  /**
   * Stream a VectorAmp Intelligence answer as server-sent events.
   *
   * @param request - Question string or full ask request. `stream` is forced to `true`.
   * @returns An async iterable of stream events.
   */
  async *askStream(request: string | AskRequest): AsyncIterable<StreamEvent> {
    if (!this.transport.stream) {
      throw new Error('Configured transport does not support streaming responses.');
    }

    const body = typeof request === 'string' ? { question: request, stream: true } : { ...request, stream: true };
    yield* this.transport.stream('POST', '/intelligence/query/stream', { body: toSnakeCasePayload(body) }) as AsyncIterable<StreamEvent>;
  }
}
