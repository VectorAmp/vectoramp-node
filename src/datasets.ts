import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';
import type {
  AddTextsInput,
  AddTextsRequest,
  AskRequest,
  AskResponse,
  CreateDatasetRequest,
  Dataset,
  DatasetDocument,
  DatasetDocumentListParams,
  IngestFile,
  IngestFilesystemOptions,
  IngestFilesystemRequest,
  IngestSourceInput,
  IngestionJob,
  InsertVectorsRequest,
  Page,
  PaginationParams,
  SearchInput,
  SearchResponse,
  Transport
} from './types.js';
import { normalizePage, toSnakeCasePayload } from './utils.js';

const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.mdx', '.json', '.jsonl', '.csv', '.tsv', '.html', '.xml', '.yaml', '.yml']);

/** Minimal client context used by dataset resource helpers that call Intelligence. */
export interface DatasetClientContext {
  /** Ask an intelligence question using the parent client. */
  ask(request: string | AskRequest): Promise<AskResponse>;
}

/** Dataset object returned by the API with convenience methods bound to its id. */
export class DatasetResource implements Dataset {
  /** Dataset identifier. */
  readonly id: string;
  /** Original API payload used to construct this resource. */
  readonly rawData!: Dataset;
  /** Dataset service used by bound helper methods. */
  readonly service!: DatasetsClient;
  /** Optional parent client context for `ask`. */
  readonly client?: DatasetClientContext;
  /** Human-readable dataset name, when returned by the API. */
  name?: string;
  /** Vector dimension, when returned by the API. */
  dimension?: number;
  /** Dataset metadata, when returned by the API. */
  metadata?: Record<string, unknown>;
  [key: string]: unknown;

  /**
   * Wrap a dataset API payload as a resource.
   *
   * @param service - Dataset service used for follow-up calls.
   * @param data - Dataset API payload. Must include `id`.
   * @param client - Optional parent client context used by {@link ask}.
   */
  constructor(service: DatasetsClient, data: Dataset, client?: DatasetClientContext) {
    if (!data.id) throw new Error('dataset id is required');
    Object.assign(this, data);
    this.id = data.id;

    Object.defineProperties(this, {
      rawData: { value: { ...data }, enumerable: false },
      service: { value: service, enumerable: false },
      client: { value: client, enumerable: false }
    });
  }

  /**
   * Search this dataset.
   *
   * @param request - Query text, query vector, or search options.
   * @returns Search results from this dataset.
   */
  search(request: SearchInput): Promise<SearchResponse> {
    return this.service.search(this.id, request);
  }

  /**
   * Insert vectors into this dataset.
   *
   * @param vectorsOrRequest - Vector records or an insert request.
   * @returns API response for the insert operation.
   */
  insert(vectorsOrRequest: VectorRecordInput[] | InsertVectorsRequest): Promise<unknown> {
    return this.service.insert(this.id, vectorsOrRequest);
  }

  /**
   * Add text records to this dataset for embedding and indexing.
   *
   * @param textsOrRequest - Single text, text records, or an add-texts request.
   * @returns API response for the text ingestion operation.
   */
  addTexts(textsOrRequest: AddTextsInput): Promise<unknown> {
    return this.service.addTexts(this.id, textsOrRequest);
  }

  /**
   * Delete this dataset.
   *
   * @returns Resolves when the API accepts the deletion.
   */
  delete(): Promise<void> {
    return this.service.delete(this.id);
  }

  /**
   * List source documents retained for this dataset.
   *
   * @param params - Optional cursor pagination params (`limit`, `cursor`, `status`).
   * @returns A page of dataset document metadata.
   */
  listDocuments(params: DatasetDocumentListParams = {}): Promise<Page<DatasetDocument>> {
    return this.service.listDocuments(this.id, params);
  }

  /**
   * Download a retained source document as raw bytes.
   *
   * @param documentId - Document id returned by {@link listDocuments}.
   * @returns Raw document bytes.
   */
  downloadDocument(documentId: string): Promise<ArrayBuffer> {
    return this.service.downloadDocument(this.id, documentId);
  }

  /**
   * Ask Intelligence against this dataset.
   *
   * @param request - Question string or full ask request. `datasetId` is set to this dataset id.
   * @returns Generated answer and citations.
   */
  ask(request: string | AskRequest): Promise<AskResponse> {
    if (!this.client) throw new Error('dataset ask requires a VectorAmp client context');
    const askRequest = typeof request === 'string' ? { question: request } : request;
    return this.client.ask({ ...askRequest, datasetId: this.id });
  }

  /**
   * Start ingestion from an existing or inline source for this dataset.
   *
   * @param request - Source id string, source reference, or source creation-style input.
   * @returns The created ingestion job.
   */
  ingestSource(request: IngestSourceInput): Promise<IngestionJob> {
    return this.service.ingestSource(this.id, request);
  }

  /**
   * Ingest already-read local file contents into this dataset.
   *
   * @param request - Files and optional source information. If no source id is supplied, a `file_upload` source is auto-created.
   * @returns The created ingestion job.
   */
  ingestFiles(request: IngestFilesystemRequest): Promise<IngestionJob> {
    return this.service.ingestFiles(this.id, request);
  }

  /**
   * Read text files from disk and ingest them into this dataset.
   *
   * @param root - Directory to walk recursively.
   * @param options - File filters, metadata, and optional source information.
   * @returns The created ingestion job.
   */
  ingestFilesystem(root: string, options: IngestFilesystemOptions = {}): Promise<IngestionJob> {
    return this.service.ingestFilesystem(this.id, root, options);
  }
}

/** Dataset management, search, insertion, and ingestion API client. */
export class DatasetsClient {
  constructor(
    private readonly transport: Transport,
    private readonly options: { client?: DatasetClientContext } = {}
  ) {}

  /**
   * List datasets.
   *
   * @param params - Optional pagination params (`limit`, `offset`).
   * @returns A page of dataset resources.
   */
  async list(params: PaginationParams = {}): Promise<Page<DatasetResource>> {
    const payload = await this.transport.request<unknown>('GET', '/datasets', { query: { ...params } });
    const page = normalizePage<Dataset>(payload, params);
    return { ...page, data: page.data.map((dataset) => this.toResource(dataset)) };
  }

  /**
   * Fetch a dataset by id.
   *
   * @param id - Dataset id.
   * @returns The dataset resource.
   */
  get(id: string): Promise<DatasetResource> {
    const path = datasetPath(id);
    return this.transport.request<Dataset>('GET', path).then((dataset) => this.toResource(dataset));
  }

  /**
   * Create a SABLE-backed dataset.
   *
   * @param request - Dataset creation options. Any supplied `indexType`/`index_type` is ignored; the SDK always sends `sable`.
   * @returns The created dataset resource.
   */
  async create(request: CreateDatasetRequest): Promise<DatasetResource> {
    const { index_type: _ignoredIndexType, indexType: _ignoredIndexTypeCamel, ...safeRequest } = request as CreateDatasetRequest & {
      index_type?: never;
      indexType?: never;
    };

    const dataset = await this.transport.request<Dataset>('POST', '/datasets', {
      body: toSnakeCasePayload({ ...safeRequest, indexType: 'sable' })
    });
    return this.toResource(dataset);
  }

  /**
   * Delete a dataset by id.
   *
   * @param id - Dataset id.
   * @returns Resolves when the API accepts the deletion.
   */
  delete(id: string): Promise<void> {
    return this.transport.request<void>('DELETE', datasetPath(id));
  }

  /**
   * List source documents retained for a dataset.
   *
   * @param id - Dataset id.
   * @param params - Optional cursor pagination params (`limit`, `cursor`, `status`).
   * @returns A page of document metadata.
   */
  async listDocuments(id: string, params: DatasetDocumentListParams = {}): Promise<Page<DatasetDocument>> {
    const payload = await this.transport.request<unknown>('GET', `${datasetPath(id)}/documents`, { query: { ...params } });
    return normalizePage<DatasetDocument>(payload, { limit: params.limit }, 'documents');
  }

  /**
   * Download a retained source document as raw bytes.
   *
   * @param id - Dataset id.
   * @param documentId - Document id returned by {@link listDocuments}.
   * @returns Raw document bytes.
   */
  downloadDocument(id: string, documentId: string): Promise<ArrayBuffer> {
    if (!this.transport.download) throw new Error('transport does not support raw downloads');
    return this.transport.download('GET', `${datasetPath(id)}/documents/${encodeURIComponent(documentId)}/download`);
  }

  /**
   * Search a dataset by text or vector.
   *
   * @param id - Dataset id.
   * @param request - Query text, query vector, or search options.
   * @returns Search results from the API.
   */
  search(id: string, request: SearchInput): Promise<SearchResponse> {
    const body = normalizeSearchRequest(request);
    return this.transport.request<SearchResponse>('POST', `${datasetPath(id)}/search`, { body });
  }

  /**
   * Insert vectors into a dataset.
   *
   * @param id - Dataset id.
   * @param vectorsOrRequest - Vector records or an insert request.
   * @returns API response for the insert operation.
   */
  insert(id: string, vectorsOrRequest: VectorRecordInput[] | InsertVectorsRequest): Promise<unknown> {
    const request = Array.isArray(vectorsOrRequest) ? { vectors: vectorsOrRequest } : vectorsOrRequest;
    return this.transport.request<unknown>('POST', `${datasetPath(id)}/vectors`, { body: toSnakeCasePayload(request) });
  }

  /**
   * Add text records to a dataset for embedding and indexing.
   *
   * @param id - Dataset id.
   * @param textsOrRequest - Single text, text records, or an add-texts request.
   * @returns API response for the text ingestion operation.
   */
  addTexts(id: string, textsOrRequest: AddTextsInput): Promise<unknown> {
    const request = normalizeAddTextsRequest(textsOrRequest);
    return this.transport.request<unknown>('POST', `${datasetPath(id)}/texts`, { body: toSnakeCasePayload(request) });
  }

  /**
   * Start ingestion from an existing or inline source.
   *
   * @param id - Dataset id.
   * @param request - Source id string, source reference, or source creation-style input.
   * @returns The created ingestion job.
   */
  ingestSource(id: string, request: IngestSourceInput): Promise<IngestionJob> {
    return this.transport.request<IngestionJob>('POST', `${datasetPath(id)}/ingestions/sources`, {
      body: toSnakeCasePayload(normalizeIngestSourceInput(request))
    });
  }

  /**
   * Ingest already-read local file contents into a dataset.
   *
   * @param id - Dataset id.
   * @param request - Files and optional source information. If no `sourceId`, `source_id`, or `source` is supplied, a `file_upload` source is auto-created.
   * @returns The created ingestion job.
   */
  async ingestFiles(id: string, request: IngestFilesystemRequest): Promise<IngestionJob> {
    const body = await this.withLocalFileSource(request);
    return this.transport.request<IngestionJob>('POST', `${datasetPath(id)}/ingestions/filesystem`, {
      body: toSnakeCasePayload(body)
    });
  }

  /**
   * Read text files from disk and ingest them into a dataset.
   *
   * @param id - Dataset id.
   * @param root - Directory to walk recursively.
   * @param options - File filters, metadata, and optional source information.
   * @returns The created ingestion job.
   */
  async ingestFilesystem(id: string, root: string, options: IngestFilesystemOptions = {}): Promise<IngestionJob> {
    const files = await collectTextFiles(root, options);
    return this.ingestFiles(id, {
      root,
      files,
      metadata: options.metadata,
      source: options.source,
      sourceId: options.sourceId,
      source_id: options.source_id,
      sourceName: options.sourceName
    });
  }

  private async withLocalFileSource(request: IngestFilesystemRequest): Promise<IngestFilesystemRequest> {
    const explicitSourceId = request.sourceId ?? request.source_id ?? request.source;
    if (explicitSourceId) return withCanonicalSourceId(request, explicitSourceId);

    const source = await this.transport.request<{ id?: string }>('POST', '/ingestion/sources', {
      body: toSnakeCasePayload({ sourceType: 'file_upload', name: request.sourceName ?? defaultFileUploadSourceName(request.root) })
    });
    if (!source.id) throw new Error('VectorAmp API did not return an id for the auto-created file upload source');

    return withCanonicalSourceId(request, source.id);
  }

  private toResource(dataset: Dataset): DatasetResource {
    return new DatasetResource(this, dataset, this.options.client);
  }
}

type VectorRecordInput = InsertVectorsRequest['vectors'][number];

function datasetPath(id: string): string {
  if (!id) throw new Error('dataset id is required');
  return `/datasets/${encodeURIComponent(id)}`;
}

function normalizeSearchRequest(request: SearchInput): unknown {
  if (typeof request === 'string') return { query_text: request };
  if (Array.isArray(request)) return { query: request };

  const { vector, query, queryText, topK, includeVectors, includeMetadata, ...rest } = request;
  return toSnakeCasePayload({
    ...rest,
    query: query ?? vector,
    queryText,
    topK,
    includeVectors,
    includeMetadata
  });
}

function normalizeAddTextsRequest(textsOrRequest: AddTextsInput): AddTextsRequest {
  if (typeof textsOrRequest === 'string') return { texts: [textsOrRequest] };
  return Array.isArray(textsOrRequest) ? { texts: textsOrRequest } : textsOrRequest;
}

function normalizeIngestSourceInput(request: IngestSourceInput): IngestSourceInput | { sourceId: string } {
  return typeof request === 'string' ? { sourceId: request } : request;
}

function defaultFileUploadSourceName(root?: string): string {
  const label = root ? basename(root) || root : undefined;
  return label ? `Local files: ${label}` : 'Local file upload';
}

function withCanonicalSourceId(request: IngestFilesystemRequest, sourceId: string): IngestFilesystemRequest {
  const { sourceName: _sourceName, source: _source, sourceId: _sourceId, source_id: _sourceIdSnake, ...rest } = request;
  return { ...rest, sourceId };
}

async function collectTextFiles(
  root: string,
  options: { extensions?: string[]; maxBytesPerFile?: number }
): Promise<IngestFile[]> {
  const extensions = options.extensions ? new Set(options.extensions.map((ext) => ext.toLowerCase())) : TEXT_EXTENSIONS;
  const maxBytes = options.maxBytesPerFile ?? 1024 * 1024;
  const files: IngestFile[] = [];

  async function walk(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      const extension = entry.name.includes('.') ? entry.name.slice(entry.name.lastIndexOf('.')).toLowerCase() : '';
      if (!extensions.has(extension)) continue;
      const info = await stat(absolute);
      if (info.size > maxBytes) continue;
      files.push({ path: relative(root, absolute), content: await readFile(absolute, 'utf8') });
    }
  }

  await walk(root);
  return files;
}
