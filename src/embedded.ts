import { randomUUID } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { RequestOptions, Transport } from './types.js';

export type EmbeddedNativeStatus = {
  state: 'exact' | 'training' | 'indexed' | 'failed';
  vectorCount: number;
  trainingThreshold: number;
  trainingError?: string;
};

export type EmbeddedNativeCollection = {
  insert(records: Array<{ id: number | bigint | string; values: number[]; metadata?: Record<string, string> }>): Promise<void>;
  search(query: number[], topK: number, filter?: unknown): Promise<Array<{ id: string; distance: number; metadata: Record<string, string> }>>;
  optimize(): Promise<void>;
  status(): Promise<EmbeddedNativeStatus>;
  close(): Promise<void>;
};

export type EmbeddedRuntime = {
  SableCollection: {
    create(options: Record<string, unknown>): Promise<EmbeddedNativeCollection>;
    open(path: string): Promise<EmbeddedNativeCollection>;
  };
};

type DatasetRecord = {
  id: string;
  name: string;
  dim: number;
  dimension: number;
  metric: string;
  metadata_schema: Record<string, string>;
  index_type: 'sable';
  mode: 'embedded';
};

type Catalog = { format_version: 1; datasets: Record<string, DatasetRecord> };

const DATASET_PATH = /^\/datasets\/([^/]+)(?:\/(search|insert|stats|optimize|index-status))?$/;
const RUNTIME_PACKAGE = '@vectoramp/sable-embedded-runtime';

/** Dataset/vector transport backed by the native single-node SABLE runtime. */
export class EmbeddedTransport implements Transport {
  private readonly root: string;
  private readonly catalogPath: string;
  private readonly runtime?: EmbeddedRuntime;
  private runtimePromise?: Promise<EmbeddedRuntime>;
  private readonly collections = new Map<string, EmbeddedNativeCollection>();
  private catalog: Catalog;

  constructor(root: string, runtime?: EmbeddedRuntime) {
    this.root = resolve(root);
    mkdirSync(this.root, { recursive: true });
    this.catalogPath = resolve(this.root, 'catalog.json');
    this.runtime = runtime;
    this.catalog = this.loadCatalog();
  }

  async request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
    const verb = method.toUpperCase();
    if (path === '/datasets') {
      if (verb === 'POST') return this.createDataset((options.body ?? {}) as Record<string, unknown>) as Promise<T>;
      if (verb === 'GET') {
        const values = Object.values(this.catalog.datasets);
        const offset = Number(options.query?.offset ?? 0);
        const limit = Number(options.query?.limit ?? 50);
        return { datasets: values.slice(offset, offset + limit), total: values.length, limit, offset } as T;
      }
    }

    const match = DATASET_PATH.exec(path);
    if (!match) throw new Error(`${path} is not available in embedded mode`);
    const [, datasetId, operation] = match;
    const dataset = this.dataset(datasetId);
    if (!operation && verb === 'GET') return { ...dataset } as T;
    if (!operation && verb === 'DELETE') {
      await this.deleteDataset(datasetId);
      return undefined as T;
    }
    const collection = await this.collection(datasetId);
    if (operation === 'stats' && verb === 'GET') {
      const status = await collection.status();
      return { vector_count: status.vectorCount, index_state: status.state } as T;
    }
    if (operation === 'index-status' && verb === 'GET') return collection.status() as Promise<T>;
    if (operation === 'optimize' && verb === 'POST') {
      await collection.optimize();
      return collection.status() as Promise<T>;
    }
    if (operation === 'insert' && verb === 'POST') return this.insert(collection, options.body) as Promise<T>;
    if (operation === 'search' && verb === 'POST') return this.search(collection, dataset, options.body) as Promise<T>;
    throw new Error(`${verb} is not allowed for ${path}`);
  }

  async close(): Promise<void> {
    await Promise.all([...this.collections.values()].map((collection) => collection.close()));
    this.collections.clear();
  }

  private async createDataset(body: Record<string, unknown>): Promise<DatasetRecord> {
    const dimension = Number(body.dim ?? body.dimension ?? 0);
    if (!Number.isSafeInteger(dimension) || dimension <= 0) throw new Error('dim is required in embedded mode');
    const id = randomUUID();
    const metadataSchema = (body.metadata_schema ?? {}) as Record<string, string>;
    const tuning = (body.tuning ?? {}) as Record<string, unknown>;
    const dataset: DatasetRecord = {
      id,
      name: String(body.name ?? id),
      dim: dimension,
      dimension,
      metric: String(body.metric ?? 'cosine'),
      metadata_schema: metadataSchema,
      index_type: 'sable',
      mode: 'embedded'
    };
    const runtime = await this.loadRuntime();
    const collection = await runtime.SableCollection.create({
      path: resolve(this.root, 'datasets', id),
      dimension,
      metric: dataset.metric,
      metadataSchema,
      l0Capacity: Number(tuning.l0_capacity ?? 10_000),
      trainingThreshold: Number(tuning.training_threshold ?? 10_000)
    });
    this.catalog.datasets[id] = dataset;
    this.collections.set(id, collection);
    this.saveCatalog();
    return dataset;
  }

  private async insert(collection: EmbeddedNativeCollection, rawBody: unknown): Promise<{ inserted: number }> {
    const body = (rawBody ?? {}) as { vectors?: Array<Record<string, unknown>> };
    const vectors = body.vectors ?? [];
    const records = vectors.map((record) => {
      const id = record.id;
      if (!(typeof id === 'bigint' || (typeof id === 'number' && Number.isSafeInteger(id) && id >= 0))) {
        throw new Error('embedded vector ids must be non-negative safe integers or bigint values');
      }
      return {
        id,
        values: (record.values ?? []) as number[],
        metadata: Object.fromEntries(
          Object.entries((record.metadata ?? {}) as Record<string, unknown>).map(([key, value]) => [key, String(value)])
        )
      };
    });
    await collection.insert(records);
    return { inserted: records.length };
  }

  private async search(collection: EmbeddedNativeCollection, dataset: DatasetRecord, rawBody: unknown): Promise<unknown> {
    const body = (rawBody ?? {}) as Record<string, unknown>;
    if (!Array.isArray(body.query)) throw new Error('embedded mode requires a vector query');
    const equality = (body.filters ?? body.filter ?? {}) as Record<string, unknown>;
    const advanced = (body.advanced_filters ?? []) as Array<Record<string, unknown>>;
    const normalizedEquality = Object.fromEntries(Object.entries(equality).map(([key, value]) => [key, String(value)]));
    const ranges: Array<Record<string, unknown>> = [];
    const predicates: Array<Record<string, unknown>> = [];
    for (const item of advanced) {
      const field = String(item.field ?? item.key ?? '');
      const declaredKind = dataset.metadata_schema[field]?.toLowerCase();
      if (!field || !declaredKind) throw new Error(`advanced filter field ${JSON.stringify(field)} was not declared`);
      const kind = String(item.kind ?? item.type ?? declaredKind).toLowerCase();
      if (kind !== declaredKind) {
        throw new Error(`advanced filter for ${JSON.stringify(field)} uses ${JSON.stringify(kind)}, but the field is ${JSON.stringify(declaredKind)}`);
      }
      if ('op' in item) {
        const op = String(item.op ?? '').toLowerCase();
        if (!('value' in item) || item.value == null) throw new Error(`advanced filter ${JSON.stringify(field)} requires a value`);
        if (kind === 'string') {
          if (op !== 'eq') throw new Error(`string advanced filter ${JSON.stringify(op)} is unsupported`);
          normalizedEquality[field] = String(item.value);
          continue;
        }
        if (!['eq', 'gt', 'ge', 'gte', 'lt', 'le', 'lte'].includes(op)) {
          throw new Error(`unsupported embedded advanced filter ${JSON.stringify(item)}`);
        }
        predicates.push({ field, kind, op, value: item.value });
        continue;
      }
      const minInclusive = item.min_inclusive ?? item.gte;
      const maxInclusive = item.max_inclusive ?? item.lte;
      if (kind === 'string' || (minInclusive == null && maxInclusive == null)) {
        throw new Error(`unsupported embedded range filter ${JSON.stringify(item)}`);
      }
      ranges.push({ field, kind, minInclusive, maxInclusive });
    }
    const filter = Object.keys(normalizedEquality).length || ranges.length || predicates.length
      ? { equality: normalizedEquality, ranges, predicates }
      : undefined;
    const hits = await collection.search(body.query as number[], Number(body.top_k ?? 10), filter);
    const includeMetadata = body.include_metadata !== false;
    return {
      results: hits.map((hit) => ({
        id: hit.id,
        distance: hit.distance,
        score: hit.distance,
        ...(includeMetadata ? { metadata: hit.metadata } : {})
      }))
    };
  }

  private dataset(id: string): DatasetRecord {
    const dataset = this.catalog.datasets[id];
    if (!dataset) throw new Error(`dataset ${id} was not found`);
    return dataset;
  }

  private async collection(id: string): Promise<EmbeddedNativeCollection> {
    this.dataset(id);
    let collection = this.collections.get(id);
    if (!collection) {
      const runtime = await this.loadRuntime();
      collection = await runtime.SableCollection.open(resolve(this.root, 'datasets', id));
      this.collections.set(id, collection);
    }
    return collection;
  }

  private loadRuntime(): Promise<EmbeddedRuntime> {
    if (this.runtime) return Promise.resolve(this.runtime);
    this.runtimePromise ??= import(RUNTIME_PACKAGE).then((module) => module as unknown as EmbeddedRuntime);
    return this.runtimePromise;
  }

  private async deleteDataset(id: string): Promise<void> {
    this.dataset(id);
    const collection = this.collections.get(id);
    if (collection) await collection.close();
    this.collections.delete(id);
    delete this.catalog.datasets[id];
    this.saveCatalog();
    rmSync(resolve(this.root, 'datasets', id), { recursive: true, force: true });
  }

  private loadCatalog(): Catalog {
    if (!existsSync(this.catalogPath)) return { format_version: 1, datasets: {} };
    const catalog = JSON.parse(readFileSync(this.catalogPath, 'utf8')) as Catalog;
    if (catalog.format_version !== 1 || !catalog.datasets) throw new Error('unsupported embedded VectorAmp catalog');
    return catalog;
  }

  private saveCatalog(): void {
    const temporary = `${this.catalogPath}.tmp`;
    writeFileSync(temporary, JSON.stringify(this.catalog), { encoding: 'utf8', flush: true });
    renameSync(temporary, this.catalogPath);
    const fd = openSync(this.root, 'r');
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  }
}
