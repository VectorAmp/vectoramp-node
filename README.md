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

await dataset.addTexts([
  'VectorAmp stores and searches vectors at scale.',
  { text: 'SABLE is VectorAmp\'s index architecture.', metadata: { source: 'whitepaper' } }
]);

const results = await dataset.search({
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

`create`, `get`, and `list` return `DatasetResource` objects. They expose the raw dataset fields (`id`, `name`, `metadata`, etc.) plus instance methods for common dataset-scoped operations. Service-style calls remain supported.

```ts
// Pagination envelopes are always returned for list methods.
const page = await client.datasets.list({ limit: 20, offset: 0 });
console.log(page.data, page.total, page.nextOffset);

const dataset = await client.datasets.get('dataset_id');
console.log(dataset.id, dataset.rawData);

await dataset.delete();

// Service-style methods still work when you prefer explicit ids.
await client.datasets.delete('dataset_id');
```

## Insert vectors

```ts
const dataset = await client.datasets.get('dataset_id');

await dataset.insert([
  { id: 'vec_1', vector: [0.12, 0.98, 0.42], metadata: { title: 'Intro' } }
]);

// Equivalent service-style call:
await client.datasets.insert(dataset.id, [
  { id: 'vec_2', vector: [0.22, 0.18, 0.62] }
]);
```

## Add texts

```ts
// Single string for the common case:
await dataset.addTexts('Plain text chunk');

// Or batch strings / structured text records:
await dataset.addTexts([
  'Another plain text chunk',
  { id: 'doc_2', text: 'Text with metadata', metadata: { url: 'https://example.com' } }
]);
```

## Search

```ts
// Minimal text search:
await dataset.search('semantic query');

// Full search options remain available:
await dataset.search({
  queryText: 'semantic query',
  topK: 10,
  includeMetadata: true
});

// Service-style calls accept text, vectors, or full request objects.
await client.datasets.search(dataset.id, [0.1, 0.2, 0.3]);
```

## Ingestion

Source builders keep ingestion payloads typed while matching the REST `source_type` contract (`s3`, `web`, `gdrive`, `file_upload`).

```ts
import { s3Source, webSource } from '@vectoramp/vectoramp';

await dataset.ingestSource(s3Source({
  uri: 's3://my-bucket/docs/',
  config: { recursive: true }
}));

await dataset.ingestSource(webSource('https://docs.example.com'));

// Existing source ids are accepted too.
await dataset.ingestSource('source_id');
```

You can create reusable ingestion sources through `client.sources`:

```ts
const web = await client.sources.createWeb({ url: 'https://docs.example.com' });
const s3 = await client.sources.createS3('s3://my-bucket/docs/');
const drive = await client.sources.createGoogleDrive({ folderId: 'google-drive-folder-id' });
const upload = await client.sources.createFileUpload({ fileIds: ['uploaded_file_id'] });
```

Use `genericSource(sourceType, payload)` as an escape hatch for source types not yet modeled by the SDK.

The older generic shape remains supported for compatibility:

```ts
await dataset.ingestSource({
  source: 's3',
  uri: 's3://my-bucket/docs/',
  config: { recursive: true }
});
```

For local filesystem ingestion, the SDK reads common text files and sends their contents to the filesystem ingestion endpoint. You do **not** need to create or name a source first: when `sourceId`/`source` is omitted, the SDK creates a `file_upload` source with a default name like `Local files: docs` and attaches it automatically.

```ts
await dataset.ingestFilesystem('./docs', {
  extensions: ['.md', '.txt'],
  maxBytesPerFile: 512_000
});

// Optional: customize the auto-created source name or use an existing source id.
await dataset.ingestFilesystem('./docs', { sourceName: 'Product docs upload' });
await dataset.ingestFilesystem('./docs', { sourceId: 'existing_source_id' });

// Inline file payloads work the same way and also auto-create a file_upload source.
await dataset.ingestFiles({
  files: [{ path: 'intro.md', content: '# Intro' }]
});
```

## Intelligence / ask

```ts
const answer = await dataset.ask('What changed in the Q4 planning docs?');

// Full ask options remain available when needed.
await dataset.ask({
  question: 'What changed in the Q4 planning docs?',
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
