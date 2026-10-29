import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { VectorAmpClient } from '../client.js';
import { EmbeddedTransport, type EmbeddedNativeDataset, type EmbeddedRuntime } from '../embedded.js';

class FakeDataset implements EmbeddedNativeDataset {
  readonly records: Array<{ id: string; values: number[]; metadata?: Record<string, string> }> = [];
  indexed = false;
  lastFilter: unknown;
  closed = false;

  async insert(records: Array<{ id: number | bigint | string; values: number[]; metadata?: Record<string, string> }>): Promise<void> {
    this.records.push(...records.map((record) => ({ ...record, id: String(record.id) })));
  }

  async search(_query: number[], topK: number, filter?: { equality?: Record<string, string>; ranges?: unknown[]; predicates?: unknown[] }) {
    this.lastFilter = filter;
    return this.records
      .filter((record) => Object.entries(filter?.equality ?? {}).every(([key, value]) => record.metadata?.[key] === value))
      .slice(0, topK)
      .map((record, index) => ({ id: record.id, distance: index, metadata: record.metadata ?? {} }));
  }

  async optimize(): Promise<void> {
    this.indexed = true;
  }

  async status() {
    return {
      state: this.indexed ? 'indexed' as const : 'exact' as const,
      vectorCount: this.records.length,
      trainingThreshold: 10_000
    };
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

describe('EmbeddedTransport', () => {
  const roots: string[] = [];
  afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

  it('uses the normal SDK dataset API for local SABLE', async () => {
    const datasets = new Map<string, FakeDataset>();
    const runtime: EmbeddedRuntime = {
      SableDataset: {
        async create(options) {
          const dataset = new FakeDataset();
          datasets.set(String(options.path), dataset);
          return dataset;
        },
        async open(path) {
          const dataset = datasets.get(path);
          if (!dataset) throw new Error('missing fake dataset');
          return dataset;
        }
      }
    };
    const root = mkdtempSync(join(tmpdir(), 'vectoramp-embedded-sdk-'));
    roots.push(root);
    const client = new VectorAmpClient({ transport: new EmbeddedTransport(root, runtime) });
    const dataset = await client.datasets.create({
      name: 'docs',
      dim: 3,
      metadataSchema: { tenant: 'string' },
      tuning: { trainingThreshold: 256 }
    });
    expect(await dataset.insert([
      { id: 1, values: [1, 0, 0], metadata: { tenant: 'acme' } },
      { id: 2, values: [0, 1, 0], metadata: { tenant: 'other' } }
    ])).toEqual({ inserted: 2 });
    const result = (await dataset.search({ vector: [1, 0, 0], filters: { tenant: 'acme' } })).results;
    expect(result).toHaveLength(1);
    expect(result[0]?.metadata).toEqual({ tenant: 'acme' });
    const withoutMetadata = (await dataset.search({
      vector: [1, 0, 0],
      filters: { tenant: 'acme' },
      includeMetadata: false
    })).results;
    expect(withoutMetadata[0]).not.toHaveProperty('metadata');
    const ranked = (await dataset.search({ vector: [1, 0, 0], topK: 2 })).results;
    expect(ranked[1]?.score).toBe(ranked[1]?.distance);
    expect(ranked[1]?.score).toBe(1);
    expect((await dataset.optimize()).state).toBe('indexed');
    expect((await dataset.indexStatus()).vectorCount).toBe(2);
    await client.close();
  });

  it('persists the catalog and rejects unsupported or invalid local operations', async () => {
    const datasets = new Map<string, FakeDataset>();
    const created: Array<Record<string, unknown>> = [];
    const runtime: EmbeddedRuntime = {
      SableDataset: {
        async create(options) {
          created.push(options);
          const dataset = new FakeDataset();
          datasets.set(String(options.path), dataset);
          return dataset;
        },
        async open(path) {
          const dataset = datasets.get(path);
          if (!dataset) throw new Error('missing fake dataset');
          return dataset;
        }
      }
    };
    const root = mkdtempSync(join(tmpdir(), 'vectoramp-embedded-transport-'));
    roots.push(root);
    const transport = new EmbeddedTransport(root, runtime);

    await expect(transport.request('POST', '/datasets', { body: { name: 'bad' } })).rejects.toThrow(
      'dim is required'
    );
    const dataset = await transport.request<{ id: string; name: string }>('POST', '/datasets', {
      body: { dimension: 4, metric: 'l2', metadata_schema: { ordinal: 'i32' } }
    });
    expect(dataset.name).toBe(dataset.id);
    expect(created[0]).toMatchObject({
      dimension: 4,
      metric: 'l2',
      metadataSchema: { ordinal: 'i32' },
      l0Capacity: 10_000,
      trainingThreshold: 10_000
    });
    expect(await transport.request('GET', '/datasets', { query: { offset: 0, limit: 1 } })).toMatchObject({
      total: 1,
      limit: 1,
      offset: 0
    });
    expect(await transport.request('GET', `/datasets/${dataset.id}`)).toMatchObject({ id: dataset.id });

    await expect(transport.request('POST', `/datasets/${dataset.id}/insert`, {
      body: { vectors: [{ id: -1, values: [1, 0, 0, 0] }] }
    })).rejects.toThrow('non-negative safe integers');
    await transport.request('POST', `/datasets/${dataset.id}/insert`, {
      body: { vectors: [{ id: 7n, values: [1, 0, 0, 0], metadata: { tenant: 'acme', ordinal: 7 } }] }
    });
    await expect(transport.request('POST', `/datasets/${dataset.id}/search`, { body: {} })).rejects.toThrow(
      'requires a vector query'
    );
    await transport.request('POST', `/datasets/${dataset.id}/search`, {
      body: {
        query: [1, 0, 0, 0],
        filter: { tenant: 'acme' },
        advanced_filters: [{ field: 'ordinal', kind: 'i32', gte: 1, lte: 9 }]
      }
    });
    expect(datasets.values().next().value?.lastFilter).toEqual({
      equality: { tenant: 'acme' },
      ranges: [{ field: 'ordinal', kind: 'i32', minInclusive: 1, maxInclusive: 9 }],
      predicates: []
    });
    await transport.request('POST', `/datasets/${dataset.id}/search`, {
      body: {
        query: [1, 0, 0, 0],
        filters: { tenant: 'acme' },
        advanced_filters: [{ field: 'ordinal', op: 'lt', value: 10 }]
      }
    });
    expect(datasets.values().next().value?.lastFilter).toEqual({
      equality: { tenant: 'acme' },
      ranges: [],
      predicates: [{ field: 'ordinal', kind: 'i32', op: 'lt', value: 10 }]
    });
    await expect(transport.request('POST', `/datasets/${dataset.id}/search`, {
      body: { query: [1, 0, 0, 0], advanced_filters: [{ field: 'ordinal', op: 'lt' }] }
    })).rejects.toThrow('requires a value');
    expect(await transport.request('GET', `/datasets/${dataset.id}/stats`)).toEqual({
      vector_count: 1,
      index_state: 'exact'
    });
    await expect(transport.request('PATCH', `/datasets/${dataset.id}`)).rejects.toThrow('is not allowed');
    await expect(transport.request('GET', '/sources')).rejects.toThrow('is not available in embedded mode');
    await transport.close();

    const runtimeDataset = datasets.values().next().value;
    expect(runtimeDataset?.closed).toBe(true);
    if (runtimeDataset) runtimeDataset.closed = false;
    const reopened = new EmbeddedTransport(root, runtime);
    expect(await reopened.request('GET', `/datasets/${dataset.id}`)).toMatchObject({ id: dataset.id });
    expect(await reopened.request('GET', `/datasets/${dataset.id}/stats`)).toMatchObject({ vector_count: 1 });
    await reopened.request('DELETE', `/datasets/${dataset.id}`);
    expect(runtimeDataset?.closed).toBe(true);
    await expect(reopened.request('GET', `/datasets/${dataset.id}`)).rejects.toThrow('was not found');
    await reopened.close();
  });
});
