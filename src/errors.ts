/** Details attached to an API error. */
export interface VectorAmpErrorDetails {
  /** HTTP status code. */
  status: number;
  /** HTTP status text. */
  statusText: string;
  /** Request URL. */
  url: string;
  /** Parsed error response body, when available. */
  body?: unknown;
}

/** Error thrown when the VectorAmp API returns a non-2xx response. */
export class VectorAmpError extends Error {
  readonly status: number;
  readonly statusText: string;
  readonly url: string;
  readonly body?: unknown;

  /**
   * Create an API error.
   *
   * @param message - Human-readable error message.
   * @param details - HTTP status, URL, and response body details.
   */
  constructor(message: string, details: VectorAmpErrorDetails) {
    super(message);
    this.name = 'VectorAmpError';
    this.status = details.status;
    this.statusText = details.statusText;
    this.url = details.url;
    this.body = details.body;
  }
}
