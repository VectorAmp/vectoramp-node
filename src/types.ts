import type { EmbeddingConfig } from './embeddings.js';

/** JSON object used for metadata, config, and filters. */
export type JsonObject = Record<string, unknown>;

/** Options for constructing a VectorAmp SDK client. */
export interface VectorAmpClientOptions {
  /** VectorAmp API key. Sent as `X-API-Key`; defaults to `process.env.VECTORAMP_API_KEY`. */
  apiKey?: string;
  /** API origin. Defaults to `https://api.vectoramp.com`. */
  baseUrl?: string;
  /** API prefix mounted under `baseUrl`. Defaults to `/api/v1`. */
  apiPrefix?: string;
  /** Custom fetch implementation for tests, edge runtimes, or instrumentation. */
  fetch?: typeof fetch;
  /** Custom transport. When provided, `apiKey`, `baseUrl`, `apiPrefix`, `fetch`, and `headers` are ignored. */
  transport?: Transport;
  /** Extra headers included with every REST request. */
  headers?: HeadersInit;
}

/** Low-level transport request options. */
export interface RequestOptions {
  /** Query parameters; `undefined` and `null` values are omitted. */
  query?: Record<string, string | number | boolean | undefined | null>;
  /** JSON-serializable request body. */
  body?: unknown;
  /** Per-request headers merged after client headers. */
  headers?: HeadersInit;
  /** Optional abort signal. */
  signal?: AbortSignal;
}

/** Low-level streaming transport request options. */
export interface StreamRequestOptions extends RequestOptions {
  /** Accept header for the stream; defaults to `text/event-stream` in the REST transport. */
  accept?: string;
}

/** Transport interface used by SDK clients. */
export interface Transport {
  /** Send a request and parse the response. */
  request<T>(method: string, path: string, options?: RequestOptions): Promise<T>;
  /** Send a request and return raw response bytes, when supported by the transport. */
  download?(method: string, path: string, options?: RequestOptions): Promise<ArrayBuffer>;
  /** Send a streaming request, when supported by the transport. */
  stream?(method: string, path: string, options?: StreamRequestOptions): AsyncIterable<unknown>;
}

/** Pagination parameters accepted by offset-based list endpoints. */
export interface PaginationParams {
  /** Maximum records to return. Server default applies when omitted. */
  limit?: number;
  /** Number of records to skip. Server default applies when omitted. */
  offset?: number;
}

/** Cursor pagination and filtering for dataset document listing. */
export interface DatasetDocumentListParams {
  /** Maximum documents to return. Server default applies when omitted. */
  limit?: number;
  /** Cursor from a previous page's `nextCursor` / `next_cursor`. */
  cursor?: string;
  /** Optional document status filter, e.g. `ready`. */
  status?: string;
}

/** Normalized SDK page shape returned by list helpers. */
export interface Page<T> {
  /** Page records. */
  data: T[];
  /** Requested or returned page size. */
  limit?: number;
  /** Requested or returned offset. */
  offset?: number;
  /** Total records available, when returned by the API. */
  total?: number;
  /** Next offset, when returned by offset-paginated APIs. */
  nextOffset?: number | null;
  /** Next cursor, when returned by cursor-paginated APIs. */
  nextCursor?: string | null;
  /** Whether more records are available, when returned by the API. */
  hasMore?: boolean;
}

/** Dataset returned by the API. */
export interface Dataset {
  /** Dataset identifier. */
  id: string;
  /** Human-readable dataset name. */
  name?: string;
  /** Vector dimension. */
  dimension?: number;
  /** Dataset metadata. */
  metadata?: JsonObject;
  /** Additional API fields. */
  [key: string]: unknown;
}

/** Dataset source document returned by list documents endpoints. */
export interface DatasetDocument {
  /** Document identifier used for download. */
  id: string;
  /** Original filename or title, when available. */
  file_name?: string;
  /** Source type, e.g. `s3`, `gdrive`, or `file_upload`. */
  source_type?: string;
  /** Whether a retained original can be downloaded. */
  download_available?: boolean;
  /** Additional API fields. */
  [key: string]: unknown;
}

/** Request to create a dataset. */
export interface CreateDatasetRequest {
  /** Human-readable dataset name. */
  name: string;
  /** Vector dimension, inferred for built-in embedding helpers when omitted. */
  dimension?: number;
  /** Vector dimension in snake_case/API style, inferred for built-in embedding helpers when omitted. */
  dim?: number;
  /** Dataset description. */
  description?: string;
  /** Embedding provider. Defaults to `vectoramp`. */
  embeddingProvider?: string;
  /** Embedding provider in snake_case. Defaults to `vectoramp`. */
  embedding_provider?: string;
  /** Embedding model to use for text ingestion/querying. Defaults to `VectorAmp-Embedding-4B`. */
  embeddingModel?: string;
  /** Embedding model in snake_case. Defaults to `VectorAmp-Embedding-4B`. */
  embedding_model?: string;
  /** Nested embedding config accepted by the API. Use `openai('small')` or `openai('large')` for OpenAI BYOM. */
  embedding?: Partial<EmbeddingConfig>;
  /** User metadata stored with the dataset. */
  metadata?: JsonObject;
  /** Additional API fields. `indexType`/`index_type` are ignored; the SDK always creates SABLE datasets. */
  [key: string]: unknown;
}

/** Search request options for a dataset. */
export interface SearchRequest {
  /** Query vector. Alias of `query`; `query` wins if both are set. */
  vector?: number[];
  /** Query vector. */
  query?: number[];
  /** Natural-language query text. */
  queryText?: string;
  /** Alias for `queryText` for single-field hybrid/BM25 UX. */
  searchText?: string;
  /** Optional explicit hybrid dense+sparse toggle. When omitted, dataset settings apply. */
  hybrid?: boolean;
  /** Optional explicit sparse query. When omitted for hybrid text search, the API reuses the text query. */
  sparseQuery?: string;
  /** Dense/sparse weighting for hybrid search. When omitted, dataset settings apply. */
  alpha?: number;
  /** Maximum number of nearest neighbors. Server default applies when omitted. */
  topK?: number;
  /** Metadata filter evaluated by the API. */
  filter?: JsonObject;
  /** Include raw vectors in results. Defaults to the API behavior, normally `false`. */
  includeVectors?: boolean;
  /** Include metadata in results. Defaults to the API behavior, normally `true`. */
  includeMetadata?: boolean;
  /** Additional API fields. */
  [key: string]: unknown;
}

/** Search input: text query, vector query, or full search request. */
export type SearchInput = string | number[] | SearchRequest;

/** Single search result. */
export interface SearchResult {
  /** Vector or document id. */
  id: string;
  /** Similarity score returned by the API. */
  score: number;
  /** Result metadata, present when requested and returned by the API. */
  metadata?: JsonObject;
  /** Result vector, present when `includeVectors` is enabled. */
  vector?: number[];
  /** Result text, when returned by the API. */
  text?: string;
  /** Additional API fields. */
  [key: string]: unknown;
}

/** Dataset search response. */
export interface SearchResponse {
  /** Ranked search results. */
  results: SearchResult[];
  /** Additional API fields. */
  [key: string]: unknown;
}

/** Vector record to insert. */
export interface VectorRecord {
  /** Optional record id; generated by the API when omitted. */
  id?: string;
  /** Vector values. */
  vector: number[];
  /** User metadata stored with the vector. */
  metadata?: JsonObject;
  /** Optional source text for the vector. */
  text?: string;
  /** Additional API fields. */
  [key: string]: unknown;
}

/** Request to insert vectors into a dataset. */
export interface InsertVectorsRequest {
  /** Vector records to insert. */
  vectors: VectorRecord[];
  /** Optional namespace. */
  namespace?: string;
  /** Additional API fields. */
  [key: string]: unknown;
}

/** Request to add text records to a dataset. */
export interface AddTextsRequest {
  /** Text strings or text records with optional ids and metadata. */
  texts: Array<string | { id?: string; text: string; metadata?: JsonObject }>;
  /** Metadata applied to the request. */
  metadata?: JsonObject;
  /** Optional namespace. */
  namespace?: string;
  /** Additional API fields. */
  [key: string]: unknown;
}

/** Add-texts input: one string, text records, or a full request. */
export type AddTextsInput = string | AddTextsRequest['texts'] | AddTextsRequest;

/** Built-in ingestion source types. */
export type SourceType = 's3' | 'web' | 'gcs' | 'gdrive' | 'file_upload' | 'jira' | 'confluence';

/** Shared source creation options. */
export interface BaseSourceOptions {
  /** Human-readable source name. */
  name?: string;
  /** Source URI, URL, or provider-specific locator. */
  uri?: string;
  /** Provider-specific configuration. */
  config?: JsonObject;
  /** User metadata stored with the source. */
  metadata?: JsonObject;
  /** Additional API fields. */
  [key: string]: unknown;
}

/** Web source options. */
export interface WebSourceOptions extends BaseSourceOptions {
  /** Web URL. Alias for `uri`; `uri` wins if both are set. */
  url?: string;
  /** Include linked/static page assets when ingesting pages. */
  includeAssets?: boolean;
  /** Maximum assets to retain per page. */
  maxAssetsPerPage?: number;
}

/** S3 source options. */
export interface S3SourceOptions extends BaseSourceOptions {
  /** S3 bucket name. */
  bucket?: string;
  /** Optional object prefix. */
  prefix?: string;
  /** Optional AWS region. */
  region?: string;
}

/** Google Cloud Storage source options. */
export interface GcsSourceOptions extends BaseSourceOptions {
  /** GCS bucket name. */
  bucket?: string;
  /** Optional object prefix. */
  prefix?: string;
  /** Optional Google Cloud project id. */
  projectId?: string;
}

/** Google Drive source options. */
export interface GoogleDriveSourceOptions extends BaseSourceOptions {
  /** Drive folder id. */
  folderId?: string;
  /** Drive file id. */
  fileId?: string;
}

/** File-upload source options. */
export interface FileUploadSourceOptions extends BaseSourceOptions {
  /** Optional uploaded file ids. */
  fileIds?: string[];
}

/** Jira source options. */
export interface JiraSourceOptions extends BaseSourceOptions {
  /** Atlassian cloud id returned by OAuth accessible-resources. */
  cloudId?: string;
  /** OAuth access token for Atlassian APIs. */
  accessToken?: string;
  /** Jira project keys to ingest. */
  projectKeys?: string[];
  /** Optional JQL filter. */
  jql?: string;
  /** Include issue comments. Defaults to true in SDK helpers. */
  includeComments?: boolean;
}

/** Confluence source options. */
export interface ConfluenceSourceOptions extends BaseSourceOptions {
  /** Atlassian cloud id returned by OAuth accessible-resources. */
  cloudId?: string;
  /** OAuth access token for Atlassian APIs. */
  accessToken?: string;
  /** Confluence space keys to ingest. */
  spaceKeys?: string[];
}

/** Source creation payload with a required source type. */
export interface IngestionSourceInput extends BaseSourceOptions {
  /** Source type. */
  source_type: SourceType | (string & {});
}

/** Input accepted by source creation APIs. */
export type SourceCreateInput = IngestionSourceInput;

/** Ingestion source returned by the API. */
export interface IngestionSource {
  /** Source id. */
  id?: string;
  /** Source type in snake_case responses. */
  source_type?: string;
  /** Source type in camelCase responses. */
  sourceType?: string;
  /** Human-readable source name. */
  name?: string;
  /** Source URI. */
  uri?: string;
  /** Provider-specific configuration. */
  config?: JsonObject;
  /** User metadata. */
  metadata?: JsonObject;
  /** Additional API fields. */
  [key: string]: unknown;
}

/** Request to ingest from a source. */
export interface IngestSourceRequest {
  /** Existing source id alias. */
  source?: string;
  /** Existing source id. */
  sourceId?: string;
  /** Existing source id in snake_case. */
  source_id?: string;
  /** Optional source URI for inline source requests. */
  uri?: string;
  /** Provider-specific configuration. */
  config?: JsonObject;
  /** Ingestion metadata. */
  metadata?: JsonObject;
  /** Additional API fields. */
  [key: string]: unknown;
}

/** Ingest-source input: source id string, source reference, or source creation-style payload. */
export type IngestSourceInput = string | IngestSourceRequest | IngestionSourceInput;

/** Local file content to ingest. */
export interface IngestFile {
  /** Relative file path sent to the API. */
  path: string;
  /** UTF-8 file content. */
  content: string;
  /** File metadata. */
  metadata?: JsonObject;
}

/** Request to ingest local file contents. */
export interface IngestFilesystemRequest {
  /** Root directory label. Used for the auto-created source name when `sourceName` is omitted. */
  root?: string;
  /** Files to ingest. */
  files: IngestFile[];
  /** Existing source id to attach to this ingestion. If omitted, the SDK creates a `file_upload` source. */
  sourceId?: string;
  /** Existing source id in snake_case. */
  source_id?: string;
  /** Backward-compatible existing source id alias. */
  source?: string;
  /** Name for the auto-created `file_upload` source. Defaults to `Local files: <basename(root)>` or `Local file upload`. */
  sourceName?: string;
  /** Metadata applied to the ingestion request. */
  metadata?: JsonObject;
  /** Additional API fields. */
  [key: string]: unknown;
}

/** Options for reading files from disk before ingestion. */
export interface IngestFilesystemOptions {
  /** Metadata applied to the ingestion request. */
  metadata?: JsonObject;
  /** File extensions to include. Defaults to common text extensions such as `.txt`, `.md`, `.json`, and `.csv`. */
  extensions?: string[];
  /** Maximum file size to read. Defaults to 1 MiB. */
  maxBytesPerFile?: number;
  /** Existing source id to attach to this ingestion. If omitted, the SDK creates a `file_upload` source. */
  sourceId?: string;
  /** Existing source id in snake_case. */
  source_id?: string;
  /** Backward-compatible existing source id alias. */
  source?: string;
  /** Name for the auto-created `file_upload` source. Defaults to `Local files: <basename(root)>` or `Local file upload`. */
  sourceName?: string;
}

/** Ingestion job returned by the API. */
export interface IngestionJob {
  /** Job id. */
  id?: string;
  /** Job status. */
  status?: string;
  /** Additional API fields. */
  [key: string]: unknown;
}

/** Ingestion schedule returned by the API. */
export interface Schedule {
  /** Schedule id. */
  id?: string;
  /** Organization id. */
  organizationId?: string;
  /** Source id the schedule pulls from. */
  sourceId?: string;
  /** Dataset id the schedule writes into. */
  datasetId?: string;
  /** Pipeline id used for each run. Omit/`default_pipeline` for default. */
  pipelineId?: string;
  /** Cron expression. */
  cron?: string;
  /** IANA timezone (e.g. `UTC`, `America/Los_Angeles`). */
  timezone?: string;
  /** Whether the scheduler will fire this schedule. */
  enabled?: boolean;
  /** Next scheduled run, ISO-8601. */
  nextRunAt?: string;
  /** Last completed run, ISO-8601. */
  lastRunAt?: string;
  /** Optional metadata blob. */
  metadata?: Record<string, unknown>;
  /** Additional API fields. */
  [key: string]: unknown;
}

/** Schedule creation request. */
export interface ScheduleCreateInput {
  /** Source id to ingest from. */
  sourceId: string;
  /** Dataset id to ingest into. */
  datasetId: string;
  /** Cron expression (5-field). */
  cron: string;
  /** Optional IANA timezone. Defaults to `UTC` on the server. */
  timezone?: string;
  /** Pipeline id. Omit to use the default ingestion pipeline. */
  pipelineId?: string;
  /** Whether the schedule should fire when created. Defaults to true on the server. */
  enabled?: boolean;
  /** Optional human-readable name. */
  name?: string;
  /** Optional metadata blob. */
  metadata?: Record<string, unknown>;
  /** Additional API fields. */
  [key: string]: unknown;
}

/** Schedule update request. All fields are optional. */
export type ScheduleUpdateInput = Partial<ScheduleCreateInput> & {
  /** Pause/resume the schedule. */
  enabled?: boolean;
  /** Additional API fields. */
  [key: string]: unknown;
};

/** Paginated list response shape returned by the schedules list endpoint. */
export interface ScheduleListResponse {
  /** Schedule records. */
  schedules: Schedule[];
  /** Total matching schedules. */
  total?: number;
  /** Page limit echoed by the server. */
  limit?: number;
  /** Page offset echoed by the server. */
  offset?: number;
}

/** Response returned when an immediate schedule run is requested. */
export interface ScheduleTriggerResponse {
  /** New ingestion job id created for the run. */
  jobId?: string;
  /** Additional API fields. */
  [key: string]: unknown;
}

/** Request to ask VectorAmp Intelligence. */
export interface AskRequest {
  /** Natural-language question. */
  question?: string;
  /** Query text alias accepted by the API. */
  query?: string;
  /** Dataset id to constrain the answer. */
  datasetId?: string;
  /** Dataset ids to constrain the answer. */
  datasetIds?: string[];
  /** Maximum context chunks. Server default applies when omitted. */
  topK?: number;
  /** Metadata filter for context retrieval. */
  filter?: JsonObject;
  /** Whether to stream. `askStream` always sends `true`. */
  stream?: boolean;
  /** Additional API fields. */
  [key: string]: unknown;
}

/** Intelligence response. */
export interface AskResponse {
  /** Generated answer. */
  answer?: string;
  /** Citations or context chunks returned by the API. */
  citations?: unknown[];
  /** Additional API fields. */
  [key: string]: unknown;
}

/** Server-sent event emitted by streaming intelligence responses. */
export interface StreamEvent<T = unknown> {
  /** Event name, when supplied by the API. */
  event?: string;
  /** Parsed event payload, or `[DONE]` for the terminal sentinel. */
  data: T;
  /** Event id, when supplied. */
  id?: string;
  /** Retry hint in milliseconds, when supplied. */
  retry?: number;
}
