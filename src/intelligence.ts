import type {
  AskRequest,
  AskResponse,
  CreateSessionMessageRequest,
  CreateSessionRequest,
  IntelligenceSession,
  MessageListResponse,
  SessionListResponse,
  SessionMessage,
  StreamEvent,
  Transport
} from './types.js';
import { toSnakeCasePayload } from './utils.js';

/** Natural-language query and persistent Intelligence session API client. */
export class IntelligenceClient {
  constructor(private readonly transport: Transport) {}

  /**
   * Ask VectorAmp Intelligence a question.
   *
   * @param request - Question string or full ask request. A string becomes `{ query }`.
   * @returns The generated answer, sources, chunks, message, and metadata returned by the API.
   */
  ask(request: string | AskRequest): Promise<AskResponse> {
    const body = typeof request === 'string' ? { query: request } : request;
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

    const body = typeof request === 'string' ? { query: request, stream: true } : { ...request, stream: true };
    yield* this.transport.stream('POST', '/intelligence/query', { body: toSnakeCasePayload(body) }) as AsyncIterable<StreamEvent>;
  }

  /** Create a persistent Intelligence session. */
  createSession(input: CreateSessionRequest = {}): Promise<IntelligenceSession> {
    return this.transport.request<IntelligenceSession>('POST', '/intelligence/sessions', { body: toSnakeCasePayload(input) });
  }

  /** List persistent Intelligence sessions. */
  listSessions(params: { limit?: number } = {}): Promise<SessionListResponse> {
    return this.transport.request<SessionListResponse>('GET', '/intelligence/sessions', { query: params });
  }

  /** Fetch one persistent Intelligence session. */
  getSession(id: string): Promise<IntelligenceSession> {
    return this.transport.request<IntelligenceSession>('GET', `/intelligence/sessions/${encodeURIComponent(id)}`);
  }

  /** Delete a persistent Intelligence session. */
  deleteSession(id: string): Promise<void> {
    return this.transport.request<void>('DELETE', `/intelligence/sessions/${encodeURIComponent(id)}`);
  }

  /** Append a message to a persistent Intelligence session. */
  appendMessage(sessionId: string, input: CreateSessionMessageRequest): Promise<SessionMessage> {
    return this.transport.request<SessionMessage>('POST', `/intelligence/sessions/${encodeURIComponent(sessionId)}/messages`, {
      body: toSnakeCasePayload(input)
    });
  }

  /** List messages for a persistent Intelligence session. */
  listMessages(sessionId: string, params: { limit?: number } = {}): Promise<MessageListResponse> {
    return this.transport.request<MessageListResponse>('GET', `/intelligence/sessions/${encodeURIComponent(sessionId)}/messages`, { query: params });
  }
}
