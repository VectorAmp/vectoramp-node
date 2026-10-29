import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VectorAmpClient } from '@vectoramp/vectoramp';

const root = await mkdtemp(join(tmpdir(), 'vectoramp-node-e2e-'));
const client = await VectorAmpClient.embedded(root);
const dataset = await client.datasets.create({
  name: 'sdk-e2e',
  dim: 4,
  metadataSchema: { tenant: 'string', ordinal: 'i32' },
  tuning: { trainingThreshold: 256 }
});
const vectors = Array.from({ length: 256 }, (_, index) => ({
  id: index + 1,
  values: [Math.cos(index * 0.01), Math.sin(index * 0.01), 0, 0],
  metadata: { tenant: (index + 1) % 2 === 0 ? 'acme' : 'other', ordinal: index + 1 }
}));
const inserted = await dataset.insert(vectors);
if (inserted.inserted !== 256) throw new Error(`unexpected insert response: ${JSON.stringify(inserted)}`);

function assertResults(results, expectedIds, queryAngle = 0) {
  const ids = results.map((hit) => Number(hit.id));
  if (JSON.stringify(ids) !== JSON.stringify(expectedIds)) {
    throw new Error(`wrong nearest neighbors: ${JSON.stringify(results)}`);
  }
  if (!(results[0].distance >= 0) || !(results[1].distance > 0)) {
    throw new Error(`distances did not distinguish non-identical vectors: ${JSON.stringify(results)}`);
  }
  for (let index = 0; index < results.length; index += 1) {
    const hit = results[index];
    if (index > 0 && results[index - 1].distance > hit.distance) throw new Error('distances are not sorted');
    const id = Number(hit.id);
    const expectedDistance = 1 - Math.cos((id - 1) * 0.01 - queryAngle);
    if (Math.abs(hit.distance - expectedDistance) >= 1e-5) throw new Error(`wrong distance for ${id}`);
    if (hit.score !== hit.distance) throw new Error(`score does not match hosted distance contract for ${id}`);
    if (hit.metadata?.ordinal !== String(id)) throw new Error(`missing ordinal metadata for ${id}`);
    if (hit.metadata?.tenant !== (id % 2 === 0 ? 'acme' : 'other')) throw new Error(`wrong tenant for ${id}`);
  }
}

const query = [1, 0, 0, 0];
const unfiltered = await dataset.search({ vector: query, topK: 10, includeMetadata: true });
assertResults(unfiltered.results, Array.from({ length: 10 }, (_, index) => index + 1));
const withoutMetadata = await dataset.search({ vector: query, topK: 1, includeMetadata: false });
if ('metadata' in withoutMetadata.results[0]) throw new Error('includeMetadata=false leaked metadata');
const filtered = await dataset.search({
  vector: query,
  topK: 10,
  filters: { tenant: 'acme' }
});
assertResults(filtered.results, Array.from({ length: 10 }, (_, index) => (index + 1) * 2));
const rangeQueryAngle = 1.49;
const rangeQuery = [Math.cos(rangeQueryAngle), Math.sin(rangeQueryAngle), 0, 0];
const strictFiltered = await dataset.search({
  vector: rangeQuery,
  topK: 10,
  filters: { tenant: 'acme' },
  advancedFilters: [{ field: 'ordinal', op: 'lt', value: 100 }],
  includeMetadata: true
});
assertResults(strictFiltered.results, Array.from({ length: 10 }, (_, index) => 98 - index * 2), rangeQueryAngle);

const deadline = Date.now() + 120_000;
let status = await dataset.indexStatus();
while (!['indexed', 'failed'].includes(String(status.state)) && Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, 250));
  status = await dataset.indexStatus();
}
if (status.state !== 'indexed' || status.vectorCount !== 256) {
  throw new Error(`automatic training did not finish: ${JSON.stringify(status)}`);
}
const optimized = await dataset.optimize();
if (optimized.state !== 'indexed') throw new Error(`manual optimize failed: ${JSON.stringify(optimized)}`);
assertResults(
  (await dataset.search({ vector: query, topK: 10 })).results,
  Array.from({ length: 10 }, (_, index) => index + 1)
);
assertResults(
  (await dataset.search({
    vector: rangeQuery,
    topK: 10,
    filters: { tenant: 'acme' },
    advancedFilters: [{ field: 'ordinal', op: 'lt', value: 100 }]
  })).results,
  Array.from({ length: 10 }, (_, index) => 98 - index * 2),
  rangeQueryAngle
);
const datasetId = dataset.id;
await client.close();

const reopened = await VectorAmpClient.embedded(root);
const restored = await reopened.datasets.get(datasetId);
const reopenedStatus = await restored.indexStatus();
if (reopenedStatus.vectorCount !== 256) throw new Error(`reopen lost vectors: ${JSON.stringify(reopenedStatus)}`);
const postReopen = await restored.search({
  vector: query,
  topK: 10,
  filters: { tenant: 'acme' }
});
assertResults(postReopen.results, Array.from({ length: 10 }, (_, index) => (index + 1) * 2));
const postReopenRange = await restored.search({
  vector: rangeQuery,
  topK: 10,
  filters: { tenant: 'acme' },
  advancedFilters: [{ field: 'ordinal', op: 'lt', value: 100 }],
  includeMetadata: true
});
assertResults(postReopenRange.results, Array.from({ length: 10 }, (_, index) => 98 - index * 2), rangeQueryAngle);
await reopened.close();
