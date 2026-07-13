import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type {
  AddTextsInput,
  AddTextsRequest,
  AskRequest,
  AskResponse,
  CreateDatasetRequest,
  Dataset,
  DatasetDocument,
  DatasetDocumentListParams,
  DeleteVectorsInput,
  DeleteVectorsRequest,
  DeleteVectorsResponse,
  IngestFilesOptions,
  IngestFilesystemOptions,
  IngestSourceInput,
  IngestSourceOptions,
  InitUploadResponse,
  IngestionJob,
  InsertVectorsRequest,
  Page,
  PaginationParams,
  SearchInput,
  SearchResponse,
  Transport
} from './types.js';
import { embeddingDimensions, OPENAI_TEXT_EMBEDDING_3_SMALL, VECTORAMP_EMBEDDING_4B } from './embeddings.js';
import { normalizePage, toSnakeCasePayload } from './utils.js';

const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.mdx', '.json', '.jsonl', '.csv', '.tsv', '.html', '.xml', '.yaml', '.yml']);
const CONTENT_TYPES: Record<string, string> = {
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.mdx': 'text/markdown',
  '.json': 'application/json',
  '.jsonl': 'application/x-ndjson',
  '.csv': 'text/csv',
  '.tsv': 'text/tab-separated-values',
  '.html': 'text/html',
  '.xml': 'application/xml',
  '.yaml': 'application/yaml',
  '.yml': 'application/yaml',
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
};
const DEFAULT_EMBEDDING_PROVIDER = 'vectoramp';
const DEFAULT_EMBEDDING_MODEL = VECTORAMP_EMBEDDING_4B;
const OPENAI_SECRET_REF = 'emb:openai:api_key';

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
   * Delete vectors from this dataset by id.
   *
   * @param idsOrRequest - Vector ids, or a delete request with optional write concern.
   * @returns API response with deletion counts/status.
   */
  deleteVectors(idsOrRequest: DeleteVectorsInput): Promise<DeleteVectorsResponse> {
    return this.service.deleteVectors(this.id, idsOrRequest);
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
    const askRequest = typeof request === 'string' ? { query: request } : request;
    return this.client.ask({ ...askRequest, datasetId: this.id });
  }

  /**
   * Start ingestion from an existing or inline source for this dataset.
   *
   * @param request - Source id string, source reference, or source builder input (e.g. `webSource(...)`).
   * @param options - Optional `pipelineId` override.
   * @returns The created ingestion job.
   */
  ingestSource(request: IngestSourceInput, options: IngestSourceOptions = {}): Promise<IngestionJob> {
    return this.service.ingestSource(this.id, request, options);
  }

  /**
   * Upload local files into this dataset via the presigned upload flow.
   *
   * @param paths - Local file paths to upload.
   * @param options - Optional source name, description, and metadata.
   * @returns The created ingestion job.
   */
  ingestFiles(paths: string[], options: IngestFilesOptions = {}): Promise<IngestionJob> {
    return this.service.ingestFiles(this.id, paths, options);
  }

  /**
   * Read text files from disk recursively and upload them into this dataset.
   *
   * @param root - Directory to walk recursively.
   * @param options - File filters, metadata, and optional source name.
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
    // Strip control/alias fields so they never leak into the request body; the SDK
    // forces SABLE, sends a single nested `embedding` object, and uses `dim`.
    const {
      index_type: _ignoredIndexType,
      indexType: _ignoredIndexTypeCamel,
      dimension: _dimension,
      dim: _dim,
      embedding: embeddingInput,
      embeddingProvider,
      embedding_provider: embeddingProviderSnake,
      embeddingModel,
      embedding_model: embeddingModelSnake,
      openaiApiKey,
      openai_api_key: openaiApiKeySnake,
      ...safeRequest
    } = request as CreateDatasetRequest & {
      index_type?: never;
      indexType?: never;
    };

    const savedOpenAIApiKey = openaiApiKey ?? openaiApiKeySnake;
    if (savedOpenAIApiKey) {
      await this.transport.request<void>('PUT', `/org-secrets/${encodeURIComponent(OPENAI_SECRET_REF)}`, { body: { value: savedOpenAIApiKey } });
    }

    const requestedProvider = embeddingProvider ?? embeddingProviderSnake ?? embeddingInput?.provider;
    const provider = requestedProvider ?? (savedOpenAIApiKey ? 'openai' : DEFAULT_EMBEDDING_PROVIDER);
    const model = embeddingModel ?? embeddingModelSnake ?? embeddingInput?.model ?? (provider === 'openai' ? OPENAI_TEXT_EMBEDDING_3_SMALL : DEFAULT_EMBEDDING_MODEL);
    const embedding = {
      provider,
      model,
      ...(provider === 'openai' ? { secret_ref: OPENAI_SECRET_REF } : {}),
      ...(embeddingInput ?? {})
    };
    const dim = request.dim ?? request.dimension ?? embeddingDimensions[String(embedding.model)];
    if (dim === undefined) {
      throw new Error(
        `Unable to infer vector dimension for embedding model "${embedding.model}". Pass "dim" explicitly when using a custom model.`
      );
    }

    const dataset = await this.transport.request<Dataset>('POST', '/datasets', {
      body: toSnakeCasePayload({ ...safeRequest, dim, embedding, indexType: 'sable' })
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
    const vectors = (request.vectors ?? []).map(normalizeVectorRecord);
    return this.transport.request<unknown>('POST', `${datasetPath(id)}/insert`, {
      body: toSnakeCasePayload({ ...request, vectors })
    });
  }

  /**
   * Delete vectors from a dataset by id.
   *
   * @param id - Dataset id.
   * @param idsOrRequest - Vector ids, or a delete request with optional write concern.
   * @returns API response with deletion counts/status.
   */
  deleteVectors(id: string, idsOrRequest: DeleteVectorsInput): Promise<DeleteVectorsResponse> {
    const request = normalizeDeleteVectorsRequest(idsOrRequest);
    return this.transport.request<DeleteVectorsResponse>('DELETE', `${datasetPath(id)}/vectors`, {
      body: toSnakeCasePayload(request)
    });
  }

  /**
   * Add text records to a dataset for embedding and indexing.
   *
   * @param id - Dataset id.
   * @param textsOrRequest - Single text, text records, or an add-texts request.
   * @returns API response for the text ingestion operation.
   */
  async addTexts(id: string, textsOrRequest: AddTextsInput): Promise<unknown> {
    const request = normalizeAddTextsRequest(textsOrRequest);
    const records = request.texts.map((entry) => (typeof entry === 'string' ? { text: entry } : entry));
    const texts = records.map((entry) => entry.text);
    const embedded = await this.transport.request<{ embeddings?: number[][]; embedding?: number[] }>('POST', `${datasetPath(id)}/embed`, {
      body: toSnakeCasePayload({ texts })
    });
    const embeddings = embedded.embeddings ?? (embedded.embedding ? [embedded.embedding] : []);
    if (embeddings.length !== records.length) {
      throw new Error(`VectorAmp API returned ${embeddings.length} embeddings for ${records.length} texts`);
    }
    const vectors = records.map((entry, index) => ({
      id: entry.id ?? `text-${index + 1}`,
      values: embeddings[index],
      metadata: { ...(request.metadata ?? {}), ...(entry.metadata ?? {}), text: entry.text }
    }));
    return this.transport.request<unknown>('POST', `${datasetPath(id)}/insert`, {
      body: toSnakeCasePayload({ vectors })
    });
  }

  /**
   * Start ingestion from an existing or inline source.
   *
   * When `request` is a source id string the SDK starts a job directly. When it is
   * a source builder/options object (e.g. from `webSource(...)`) the SDK first
   * creates the source via `POST /ingestion/sources`, then starts the job via
   * `POST /ingestion/jobs`.
   *
   * @param id - Dataset id.
   * @param request - Source id string, source reference, or source creation-style input.
   * @param options - Optional `pipelineId` override.
   * @returns The created ingestion job.
   */
  async ingestSource(id: string, request: IngestSourceInput, options: IngestSourceOptions = {}): Promise<IngestionJob> {
    if (!id) throw new Error('dataset id is required');
    const sourceId = await this.resolveSourceId(request);
    return this.transport.request<IngestionJob>('POST', '/ingestion/jobs', {
      body: toSnakeCasePayload({
        sourceId,
        datasetId: id,
        pipelineId: options.pipelineId
      })
    });
  }

  /**
   * Upload local files into a dataset and start ingestion.
   *
   * Hides the full presigned upload flow: the SDK auto-creates a `file_upload`
   * source, initializes presigned uploads (`POST /ingestion/sources/{id}/upload/init`),
   * PUTs each file to its presigned URL, then completes the upload
   * (`POST /ingestion/sources/{id}/upload/complete`).
   *
   * @param id - Dataset id.
   * @param paths - Local file paths to upload.
   * @param options - Optional source name, description, and metadata.
   * @returns The created ingestion job.
   */
  async ingestFiles(id: string, paths: string[], options: IngestFilesOptions = {}): Promise<IngestionJob> {
    if (!id) throw new Error('dataset id is required');
    if (!this.transport.put) {
      throw new Error('Configured transport does not support presigned file uploads.');
    }
    if (!Array.isArray(paths) || paths.length === 0) {
      throw new Error('ingestFiles requires at least one file path.');
    }

    const source = await this.transport.request<{ id?: string; source_id?: string }>('POST', '/ingestion/sources', {
      body: toSnakeCasePayload({
        sourceType: 'file_upload',
        name: options.sourceName ?? defaultFileUploadSourceName(paths[0]),
        description: options.description,
        config: { storageProvider: 's3', syncMode: 'full' },
        metadata: { datasetId: id, ...(options.metadata ?? {}) }
      })
    });
    const sourceId = source.id ?? source.source_id;
    if (!sourceId) throw new Error('VectorAmp API did not return an id for the auto-created file upload source');

    const descriptors = await Promise.all(paths.map((path) => fileDescriptor(path)));
    const init = await this.transport.request<InitUploadResponse>('POST', `/ingestion/sources/${encodeURIComponent(sourceId)}/upload/init`, {
      body: toSnakeCasePayload({ files: descriptors.map(({ name, sizeBytes, contentType }) => ({ name, sizeBytes, contentType })) })
    });

    const uploads = init.uploads ?? [];
    if (uploads.length !== paths.length) {
      throw new Error(`Upload init returned ${uploads.length} targets for ${paths.length} files.`);
    }

    const fileIds: string[] = [];
    for (let index = 0; index < uploads.length; index += 1) {
      const upload = uploads[index];
      const uploadUrl = upload.uploadUrl ?? upload.upload_url;
      const fileId = upload.fileId ?? upload.file_id;
      if (!uploadUrl || !fileId) throw new Error('Upload init response was missing an upload_url or file_id.');
      await this.transport.put(uploadUrl, descriptors[index].content, descriptors[index].contentType);
      fileIds.push(fileId);
    }

    const jobId = init.jobId ?? init.job_id;
    const job = await this.transport.request<IngestionJob>('POST', `/ingestion/sources/${encodeURIComponent(sourceId)}/upload/complete`, {
      body: toSnakeCasePayload({ jobId, fileIds })
    });
    if (job && typeof job === 'object' && !job.id && !('job_id' in job) && jobId) {
      (job as IngestionJob).id = jobId;
    }
    return job;
  }

  /**
   * Read text files from disk recursively and upload them into a dataset.
   *
   * Walks `root`, collects common text files, then routes through {@link ingestFiles}
   * (auto-created `file_upload` source + presigned upload flow).
   *
   * @param id - Dataset id.
   * @param root - Directory to walk recursively.
   * @param options - File filters, metadata, and optional source name.
   * @returns The created ingestion job.
   */
  async ingestFilesystem(id: string, root: string, options: IngestFilesystemOptions = {}): Promise<IngestionJob> {
    const paths = await collectTextFilePaths(root, options);
    if (paths.length === 0) throw new Error(`No matching files found under ${root}.`);
    return this.ingestFiles(id, paths, {
      sourceName: options.sourceName ?? defaultFileUploadSourceName(root),
      metadata: options.metadata
    });
  }

  /** Resolve an ingest-source input to a concrete source id, creating the source when needed. */
  private async resolveSourceId(request: IngestSourceInput): Promise<string> {
    if (typeof request === 'string') return request;

    const existing = request.sourceId ?? request.source_id ?? request.source;
    if (typeof existing === 'string' && existing && !('source_type' in request)) return existing;

    const created = await this.transport.request<{ id?: string; source_id?: string }>('POST', '/ingestion/sources', {
      body: toSnakeCasePayload(request)
    });
    const sourceId = created.id ?? created.source_id;
    if (!sourceId) throw new Error('VectorAmp API did not return an id for the created ingestion source.');
    return sourceId;
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

/**
 * Normalize a vector record so the array is sent under the canonical `values`
 * field the API expects. `vector` is accepted as a legacy alias.
 */
function normalizeVectorRecord(record: VectorRecordInput): Record<string, unknown> {
  const entry = record as Record<string, unknown>;
  if (entry.values === undefined && entry.vector !== undefined) {
    const { vector, ...rest } = entry;
    return { ...rest, values: vector };
  }
  return entry;
}

function normalizeSearchRequest(request: SearchInput): unknown {
  if (typeof request === 'string') return { query_text: request };
  if (Array.isArray(request)) return { query: request };

  const { vector, query, queryText, searchText, topK, includeVectors, includeMetadata, ...rest } = request;
  return toSnakeCasePayload({
    ...rest,
    query: query ?? vector,
    queryText: queryText ?? searchText,
    topK,
    includeVectors,
    includeMetadata
  });
}

function normalizeAddTextsRequest(textsOrRequest: AddTextsInput): AddTextsRequest {
  if (typeof textsOrRequest === 'string') return { texts: [textsOrRequest] };
  return Array.isArray(textsOrRequest) ? { texts: textsOrRequest } : textsOrRequest;
}

function normalizeDeleteVectorsRequest(idsOrRequest: DeleteVectorsInput): DeleteVectorsRequest {
  if (Array.isArray(idsOrRequest)) return { ids: idsOrRequest };
  if (typeof idsOrRequest === 'string' || typeof idsOrRequest === 'number') return { ids: [idsOrRequest] };
  return idsOrRequest;
}

function defaultFileUploadSourceName(pathOrRoot?: string): string {
  const label = pathOrRoot ? basename(pathOrRoot) || pathOrRoot : undefined;
  return label ? `file-upload-${label}` : 'file-upload';
}

interface FileDescriptor {
  /** Filename sent to the upload init endpoint. */
  name: string;
  /** File size in bytes. */
  sizeBytes: number;
  /** Detected content type. */
  contentType: string;
  /** Raw file bytes to PUT to the presigned URL. */
  content: Uint8Array;
}

async function fileDescriptor(path: string): Promise<FileDescriptor> {
  const info = await stat(path);
  const content = await readFile(path);
  return {
    name: basename(path),
    sizeBytes: info.size,
    contentType: guessContentType(path),
    content
  };
}

function guessContentType(path: string): string {
  const extension = path.includes('.') ? path.slice(path.lastIndexOf('.')).toLowerCase() : '';
  return CONTENT_TYPES[extension] ?? 'application/octet-stream';
}

async function collectTextFilePaths(
  root: string,
  options: { extensions?: string[]; maxBytesPerFile?: number }
): Promise<string[]> {
  const extensions = options.extensions ? new Set(options.extensions.map((ext) => ext.toLowerCase())) : TEXT_EXTENSIONS;
  const maxBytes = options.maxBytesPerFile ?? 1024 * 1024;
  const paths: string[] = [];

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
      paths.push(absolute);
    }
  }

  await walk(root);
  return paths;
}
