# VectorAmp Node SDK

Official TypeScript/JavaScript SDK for VectorAmp.

- Default API origin: `https://api.vectoramp.com`
- Auth: `X-API-Key`
- Node.js 18+ and modern runtimes with `fetch`
- TypeScript first, dual ESM/CJS package
- REST transport today, transport interface ready for gRPC later

> This repo is npm-ready, but packages are not published from this branch.

## Install

```bash
npm install @vectoramp/vectoramp
```

## Quick start

```ts
import { VectorAmp } from '@vectoramp/vectoramp';

const client = new VectorAmp({ apiKey: process.env.VECTORAMP_API_KEY });

const dataset = await client.datasets.create({
  name: 'docs',
  dimension: 768,
  metadata: { app: 'support-bot' }
});

await client.datasets.addTexts(dataset.id, [
  'VectorAmp stores and searches vectors at scale.',
  { text: 'SABLE is VectorAmp\'s index architecture.', metadata: { source: 'whitepaper' } }
]);

const results = await client.datasets.search(dataset.id, {
  queryText: 'How does VectorAmp search documents?',
  topK: 5
});

console.log(results.results);
```

Dataset creation always requests SABLE under the hood. The SDK intentionally does **not** expose an `index_type` option.

## Configuration

```ts
const client = new VectorAmp({
  apiKey: 'va_live_...',
  baseUrl: 'https://api.vectoramp.com', // default
  apiPrefix: '/api/v1'                 // default
});
```

The SDK also reads `VECTORAMP_API_KEY` when `apiKey` is omitted.

## Datasets

```ts
// Pagination envelopes are always returned for list methods.
const page = await client.datasets.list({ limit: 20, offset: 0 });
console.log(page.data, page.total, page.nextOffset);

const dataset = await client.datasets.get('dataset_id');

await client.datasets.delete('dataset_id');
```

## Insert vectors

```ts
await client.datasets.insert('dataset_id', [
  { id: 'vec_1', vector: [0.12, 0.98, 0.42], metadata: { title: 'Intro' } }
]);
```

## Add texts

```ts
await client.datasets.addTexts('dataset_id', [
  'Plain text chunk',
  { id: 'doc_2', text: 'Text with metadata', metadata: { url: 'https://example.com' } }
]);
```

## Search

```ts
await client.datasets.search('dataset_id', {
  queryText: 'semantic query',
  topK: 10,
  includeMetadata: true
});

await client.datasets.search('dataset_id', {
  vector: [0.1, 0.2, 0.3],
  topK: 10
});
```

## Ingestion

Source ingestion delegates to REST ingestion endpoints:

```ts
await client.datasets.ingestSource('dataset_id', {
  source: 's3',
  uri: 's3://my-bucket/docs/',
  config: { recursive: true }
});
```

For local filesystem ingestion, the SDK reads common text files and sends their contents to the filesystem ingestion endpoint:

```ts
await client.datasets.ingestFilesystem('dataset_id', './docs', {
  extensions: ['.md', '.txt'],
  maxBytesPerFile: 512_000
});
```

## Intelligence / ask

```ts
const answer = await client.ask({
  question: 'What changed in the Q4 planning docs?',
  datasetId: 'dataset_id',
  topK: 8
});

console.log(answer.answer);
```

Streaming uses Server-Sent Events:

```ts
for await (const event of client.askStream({ question: 'Summarize this dataset', datasetId: 'dataset_id' })) {
  if (event.event === 'done') break;
  console.log(event.data);
}
```

## Custom transport

The public transport interface keeps the SDK ready for gRPC or internal transports without changing developer UX:

```ts
import type { Transport } from '@vectoramp/vectoramp';

const transport: Transport = {
  async request(method, path, options) {
    // REST, gRPC gateway, test double, etc.
    return {};
  }
};

const client = new VectorAmp({ transport });
```

## Development

```bash
npm ci
npm run typecheck
npm test
npm run build
```

CI runs typecheck, tests with coverage, and build on GitLab.
