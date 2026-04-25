import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type {
  AddTextsRequest,
  AskRequest,
  AskResponse,
  CreateDatasetRequest,
  Dataset,
  IngestFile,
  IngestFilesystemRequest,
  IngestSourceRequest,
  IngestionJob,
  InsertVectorsRequest,
  Page,
  PaginationParams,
  SearchRequest,
  SearchResponse,
  Transport
} from './types.js';
import { normalizePage, toSnakeCasePayload } from './utils.js';

const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.mdx', '.json', '.jsonl', '.csv', '.tsv', '.html', '.xml', '.yaml', '.yml']);

export interface DatasetClientContext {
  ask(request: string | AskRequest): Promise<AskResponse>;
}

export class DatasetResource implements Dataset {
  readonly id: string;
  readonly rawData!: Dataset;
  readonly service!: DatasetsClient;
  readonly client?: DatasetClientContext;
  name?: string;
  dimension?: number;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;

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

  search(request: SearchRequest): Promise<SearchResponse> {
    return this.service.search(this.id, request);
  }

  insert(vectorsOrRequest: VectorRecordInput[] | InsertVectorsRequest): Promise<unknown> {
    return this.service.insert(this.id, vectorsOrRequest);
  }

  addTexts(textsOrRequest: AddTextsRequest['texts'] | AddTextsRequest): Promise<unknown> {
    return this.service.addTexts(this.id, textsOrRequest);
  }

  delete(): Promise<void> {
    return this.service.delete(this.id);
  }

  ask(request: string | AskRequest): Promise<AskResponse> {
    if (!this.client) throw new Error('dataset ask requires a VectorAmp client context');
    const askRequest = typeof request === 'string' ? { question: request } : request;
    return this.client.ask({ ...askRequest, datasetId: this.id });
  }

  ingestSource(request: IngestSourceRequest): Promise<IngestionJob> {
    return this.service.ingestSource(this.id, request);
  }

  ingestFiles(request: IngestFilesystemRequest): Promise<IngestionJob> {
    return this.service.ingestFiles(this.id, request);
  }

  ingestFilesystem(
    root: string,
    options: { metadata?: Record<string, unknown>; extensions?: string[]; maxBytesPerFile?: number } = {}
  ): Promise<IngestionJob> {
    return this.service.ingestFilesystem(this.id, root, options);
  }
}

export class DatasetsClient {
  constructor(
    private readonly transport: Transport,
    private readonly options: { client?: DatasetClientContext } = {}
  ) {}

  async list(params: PaginationParams = {}): Promise<Page<DatasetResource>> {
    const payload = await this.transport.request<unknown>('GET', '/datasets', { query: { ...params } });
    const page = normalizePage<Dataset>(payload, params);
    return { ...page, data: page.data.map((dataset) => this.toResource(dataset)) };
  }

  get(id: string): Promise<DatasetResource> {
    const path = datasetPath(id);
    return this.transport.request<Dataset>('GET', path).then((dataset) => this.toResource(dataset));
  }

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

  delete(id: string): Promise<void> {
    return this.transport.request<void>('DELETE', datasetPath(id));
  }

  search(id: string, request: SearchRequest): Promise<SearchResponse> {
    const body = normalizeSearchRequest(request);
    return this.transport.request<SearchResponse>('POST', `${datasetPath(id)}/search`, { body });
  }

  insert(id: string, vectorsOrRequest: VectorRecordInput[] | InsertVectorsRequest): Promise<unknown> {
    const request = Array.isArray(vectorsOrRequest) ? { vectors: vectorsOrRequest } : vectorsOrRequest;
    return this.transport.request<unknown>('POST', `${datasetPath(id)}/vectors`, { body: toSnakeCasePayload(request) });
  }

  addTexts(id: string, textsOrRequest: AddTextsRequest['texts'] | AddTextsRequest): Promise<unknown> {
    const request = Array.isArray(textsOrRequest) ? { texts: textsOrRequest } : textsOrRequest;
    return this.transport.request<unknown>('POST', `${datasetPath(id)}/texts`, { body: toSnakeCasePayload(request) });
  }

  ingestSource(id: string, request: IngestSourceRequest): Promise<IngestionJob> {
    return this.transport.request<IngestionJob>('POST', `${datasetPath(id)}/ingestions/sources`, {
      body: toSnakeCasePayload(request)
    });
  }

  ingestFiles(id: string, request: IngestFilesystemRequest): Promise<IngestionJob> {
    return this.transport.request<IngestionJob>('POST', `${datasetPath(id)}/ingestions/filesystem`, {
      body: toSnakeCasePayload(request)
    });
  }

  async ingestFilesystem(
    id: string,
    root: string,
    options: { metadata?: Record<string, unknown>; extensions?: string[]; maxBytesPerFile?: number } = {}
  ): Promise<IngestionJob> {
    const files = await collectTextFiles(root, options);
    return this.ingestFiles(id, { root, files, metadata: options.metadata });
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

function normalizeSearchRequest(request: SearchRequest): unknown {
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
