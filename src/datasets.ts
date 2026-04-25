import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type {
  AddTextsRequest,
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

export class DatasetsClient {
  constructor(private readonly transport: Transport) {}

  async list(params: PaginationParams = {}): Promise<Page<Dataset>> {
    const payload = await this.transport.request<unknown>('GET', '/datasets', { query: { ...params } });
    return normalizePage<Dataset>(payload, params);
  }

  get(id: string): Promise<Dataset> {
    return this.transport.request<Dataset>('GET', datasetPath(id));
  }

  create(request: CreateDatasetRequest): Promise<Dataset> {
    const { index_type: _ignoredIndexType, indexType: _ignoredIndexTypeCamel, ...safeRequest } = request as CreateDatasetRequest & {
      index_type?: never;
      indexType?: never;
    };

    return this.transport.request<Dataset>('POST', '/datasets', {
      body: toSnakeCasePayload({ ...safeRequest, indexType: 'sable' })
    });
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
