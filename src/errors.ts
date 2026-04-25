export interface VectorAmpErrorDetails {
  status: number;
  statusText: string;
  url: string;
  body?: unknown;
}

export class VectorAmpError extends Error {
  readonly status: number;
  readonly statusText: string;
  readonly url: string;
  readonly body?: unknown;

  constructor(message: string, details: VectorAmpErrorDetails) {
    super(message);
    this.name = 'VectorAmpError';
    this.status = details.status;
    this.statusText = details.statusText;
    this.url = details.url;
    this.body = details.body;
  }
}
