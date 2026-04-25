export type JsonObject = Record<string, unknown>;

export interface VectorAmpClientOptions {
  /** VectorAmp API key. Sent as X-API-Key. Defaults to VECTORAMP_API_KEY. */
  apiKey?: string;
  /** API origin. Defaults to https://api.vectoramp.com. */
  baseUrl?: string;
  /** API prefix mounted under baseUrl. Defaults to /api/v1. */
  apiPrefix?: string;
  /** Custom fetch implementation for tests, edge runtimes, or instrumentation. */
  fetch?: typeof fetch;
  /** Replace REST with another transport in the future (for example gRPC). */
  transport?: Transport;
  /** Extra headers included with every request. */
  headers?: HeadersInit;
}

export interface RequestOptions {
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
  headers?: HeadersInit;
  signal?: AbortSignal;
}

export interface StreamRequestOptions extends RequestOptions {
  accept?: string;
}

export interface Transport {
  request<T>(method: string, path: string, options?: RequestOptions): Promise<T>;
  stream?(method: string, path: string, options?: StreamRequestOptions): AsyncIterable<unknown>;
}

export interface PaginationParams {
  limit?: number;
  offset?: number;
}

export interface Page<T> {
  data: T[];
  limit?: number;
  offset?: number;
  total?: number;
  nextOffset?: number | null;
  hasMore?: boolean;
}

export interface Dataset {
  id: string;
  name?: string;
  dimension?: number;
  metadata?: JsonObject;
  [key: string]: unknown;
}

export interface CreateDatasetRequest {
  name: string;
  dimension?: number;
  description?: string;
  embeddingModel?: string;
  metadata?: JsonObject;
  [key: string]: unknown;
}

export interface SearchRequest {
  vector?: number[];
  query?: number[];
  queryText?: string;
  topK?: number;
  filter?: JsonObject;
  includeVectors?: boolean;
  includeMetadata?: boolean;
  [key: string]: unknown;
}

export type SearchInput = string | number[] | SearchRequest;

export interface SearchResult {
  id: string;
  score: number;
  metadata?: JsonObject;
  vector?: number[];
  text?: string;
  [key: string]: unknown;
}

export interface SearchResponse {
  results: SearchResult[];
  [key: string]: unknown;
}

export interface VectorRecord {
  id?: string;
  vector: number[];
  metadata?: JsonObject;
  text?: string;
  [key: string]: unknown;
}

export interface InsertVectorsRequest {
  vectors: VectorRecord[];
  namespace?: string;
  [key: string]: unknown;
}

export interface AddTextsRequest {
  texts: Array<string | { id?: string; text: string; metadata?: JsonObject }>;
  metadata?: JsonObject;
  namespace?: string;
  [key: string]: unknown;
}

export type AddTextsInput = string | AddTextsRequest['texts'] | AddTextsRequest;

export type SourceType = 's3' | 'web' | 'gdrive' | 'file_upload';

export interface BaseSourceOptions {
  name?: string;
  uri?: string;
  config?: JsonObject;
  metadata?: JsonObject;
  [key: string]: unknown;
}

export interface WebSourceOptions extends BaseSourceOptions {
  url?: string;
}

export interface S3SourceOptions extends BaseSourceOptions {
  bucket?: string;
  prefix?: string;
  region?: string;
}

export interface GoogleDriveSourceOptions extends BaseSourceOptions {
  folderId?: string;
  fileId?: string;
}

export interface FileUploadSourceOptions extends BaseSourceOptions {
  fileIds?: string[];
}

export interface IngestionSourceInput extends BaseSourceOptions {
  source_type: SourceType | (string & {});
}

export type SourceCreateInput = IngestionSourceInput;

export interface IngestionSource {
  id?: string;
  source_type?: string;
  sourceType?: string;
  name?: string;
  uri?: string;
  config?: JsonObject;
  metadata?: JsonObject;
  [key: string]: unknown;
}

export interface IngestSourceRequest {
  source?: string;
  sourceId?: string;
  source_id?: string;
  uri?: string;
  config?: JsonObject;
  metadata?: JsonObject;
  [key: string]: unknown;
}

export type IngestSourceInput = string | IngestSourceRequest | IngestionSourceInput;

export interface IngestFile {
  path: string;
  content: string;
  metadata?: JsonObject;
}

export interface IngestFilesystemRequest {
  root?: string;
  files: IngestFile[];
  /** Existing source id to attach to this ingestion. If omitted, the SDK creates a file_upload source. */
  sourceId?: string;
  source_id?: string;
  /** Backward-compatible existing source id alias. */
  source?: string;
  /** Name to use when the SDK auto-creates a file_upload source. */
  sourceName?: string;
  metadata?: JsonObject;
  [key: string]: unknown;
}

export interface IngestFilesystemOptions {
  metadata?: JsonObject;
  extensions?: string[];
  maxBytesPerFile?: number;
  /** Existing source id to attach to this ingestion. If omitted, the SDK creates a file_upload source. */
  sourceId?: string;
  source_id?: string;
  /** Backward-compatible existing source id alias. */
  source?: string;
  /** Name to use when the SDK auto-creates a file_upload source. */
  sourceName?: string;
}

export interface IngestionJob {
  id?: string;
  status?: string;
  [key: string]: unknown;
}

export interface AskRequest {
  question?: string;
  query?: string;
  datasetId?: string;
  datasetIds?: string[];
  topK?: number;
  filter?: JsonObject;
  stream?: boolean;
  [key: string]: unknown;
}

export interface AskResponse {
  answer?: string;
  citations?: unknown[];
  [key: string]: unknown;
}

export interface StreamEvent<T = unknown> {
  event?: string;
  data: T;
  id?: string;
  retry?: number;
}
