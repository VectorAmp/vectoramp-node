<div align="center">
  <a href="https://vectoramp.com/">
    <picture>
      <source media="(prefers-color-scheme: light)" srcset="https://vectoramp.com/logo-full-light.svg">
      <source media="(prefers-color-scheme: dark)" srcset="https://vectoramp.com/logo-full-dark.svg">
      <img alt="VectorAmp Logo" src="https://vectoramp.com/logo-full-dark.svg" width="50%">
    </picture>
  </a>
</div>

# VectorAmp Node SDK

Official TypeScript/JavaScript SDK for [VectorAmp](https://vectoramp.com).

- Default API origin: `https://api.vectoramp.com`
- Auth: `X-API-Key` (`vsk_…`)
- Node.js 18+ and modern runtimes with `fetch`
- TypeScript first, dual ESM/CJS package
- REST transport today, transport interface ready for gRPC later

## Install

```bash
npm install @vectoramp/vectoramp
```

## Quick start

```ts
import { VectorAmp } from '@vectoramp/vectoramp';

// Reads VECTORAMP_API_KEY from the environment when apiKey is omitted.
const client = new VectorAmp();

// One call creates a SABLE dataset using the default VectorAmp embedding model.
const dataset = await client.datasets.create({ name: 'docs' });

await dataset.addTexts([
  'VectorAmp stores and searches vectors at scale.',
  { text: "SABLE is VectorAmp's index architecture.", metadata: { source: 'whitepaper' } }
]);

const results = await dataset.search('How does VectorAmp search documents?');
console.log(results.results);

const answer = await dataset.ask('What is SABLE?');
console.log(answer.answer);
```

Every example below prefers the **object → method** style (`dataset.search(...)`) over the
service style (`client.datasets.search(id, ...)`). Both always work.

Dataset creation always requests SABLE under the hood. The SDK intentionally does **not**
expose an `index_type` option.

## Configuration

```ts
const client = new VectorAmp({
  apiKey: 'vsk_...',                    // or set VECTORAMP_API_KEY
  baseUrl: 'https://api.vectoramp.com'  // default; override for dedicated gateways
});
```

The SDK reads `VECTORAMP_API_KEY` when `apiKey` is omitted. Paths are unprefixed against the
public gateway (the `apiPrefix` option defaults to `''`).

## Datasets

`create`, `get`, and `list` return `DatasetResource` objects exposing the raw dataset fields
(`id`, `name`, `metadata`, …) plus instance methods for dataset-scoped operations.

```ts
// Minimal create: only a name is required. Embedding config is omitted so
// VectorAmp uses the managed VectorAmp-Embedding-4B model and infers dim 2560.
const dataset = await client.datasets.create({ name: 'docs' });

// Optional BYOM: use OpenAI only when you intentionally want that provider.
// Built-in OpenAI dimensions are inferred automatically.
import { openai } from '@vectoramp/vectoramp';
const openaiDataset = await client.datasets.create({ name: 'openai-docs', embedding: openai('large') });

// Convenience path: save/update the org OpenAI key, then create an OpenAI-backed dataset.
const byomDataset = await client.datasets.create({ name: 'byom-docs', openaiApiKey: process.env.OPENAI_API_KEY });

// Custom/unknown models require an explicit dim.
const customDataset = await client.datasets.create({
  name: 'docs',
  embedding: { provider: 'acme', model: 'acme-embed-1' },
  dim: 1024
});

// Hybrid (dense + sparse) datasets:
const hybrid = await client.datasets.create({ name: 'docs', hybrid: true });

// Optional typed metadata schema. Canonical types: STRING, U32, I32, I64,
// F32, and F64.
import { MetadataFieldType } from '@vectoramp/vectoramp';
const schema = [
  { name: 'price', type: MetadataFieldType.F32 },
  { name: 'category', type: MetadataFieldType.STRING }
];
const products = await client.datasets.create({ name: 'products', schema });

// Merge fields while retaining existing ones, or replace the complete schema.
await client.datasets.patchMetadataSchema(products.id, [
  { name: 'inventory', type: MetadataFieldType.U32 }
]);
await client.datasets.replaceMetadataSchema(products.id, schema);

// Listing returns a normalized pagination envelope.
const page = await client.datasets.list({ limit: 20, offset: 0 });
console.log(page.data, page.total, page.nextOffset);

await dataset.delete();
```

Default dimension inference: omit `embedding` to use `vectoramp/VectorAmp-Embedding-4B → 2560`. Optional BYOM inference also supports `openai/text-embedding-3-small → 1536` and `openai/text-embedding-3-large → 3072`.

## Organization secrets

Store or update the current organization's OpenAI API key without returning it to clients:

```ts
await client.orgSecrets.putOpenAIApiKey(process.env.OPENAI_API_KEY!);
await client.orgSecrets.updateOpenAIApiKey(process.env.OPENAI_API_KEY!); // alias/upsert
const status = await client.orgSecrets.hasOpenAIApiKey(); // { exists: true, secretRef: 'emb:openai:api_key' }
```

Datasets using `openai(...)` reference the saved key with `embedding.secret_ref`.

## Insert vectors

Vector ids accept a **string or an integer**; integers are serialized as JSON numbers and
preserved by the API.

```ts
await dataset.insert([
  { id: 1, values: [0.12, 0.98, 0.42], metadata: { title: 'Intro' } },  // numeric id stays numeric
  { id: 'vec_2', values: [0.22, 0.18, 0.62] }
]);
```

## Delete vectors

```ts
await dataset.deleteVectors(['vec_2']);
await client.datasets.deleteVectors(dataset.id, { ids: [1, 'vec_2'], writeConcern: 'all' });
```

## Add texts

`addTexts` embeds each text with the dataset's model, copies the source text into
`metadata.text`, generates ids when omitted, then inserts.

```ts
await dataset.addTexts('Plain text chunk');

await dataset.addTexts([
  'Another plain text chunk',
  { id: 'doc_2', text: 'Text with metadata', metadata: { url: 'https://example.com' } }
]);
```

## Search

`search` accepts a bare string (text query) or a float vector.

```ts
await dataset.search('semantic query');         // text query
await dataset.search([0.1, 0.2, 0.3]);           // vector query

await dataset.search({
  queryText: 'semantic query',
  topK: 10,
  includeMetadata: true,
  hybrid: true,
  alpha: 0.5,
  rerank: true                                   // expands to vectoramp / VectorAmp-Rerank-v1
});
```

## Ingestion

Source builders keep payloads typed while matching the REST `source_type` contract
(`web`, `s3`, `gcs`, `gdrive`, `file_upload`, `jira`, `confluence`, `github`, `gitlab`).

```ts
import { webSource, s3Source, confluenceSource } from '@vectoramp/vectoramp';

// One-liner: the SDK creates the source, then starts the ingestion job.
await dataset.ingestSource(webSource('https://docs.example.com'));
await dataset.ingestSource(s3Source('s3://my-bucket/docs/'));
await dataset.ingestSource(confluenceSource({ baseUrl: 'https://acme.atlassian.net', username: 'me', config: { apiToken: '…' } }));

// Existing source ids start a job directly.
await dataset.ingestSource('source_id');

// Optional pipeline override.
await dataset.ingestSource(webSource('https://docs.example.com'), { pipelineId: 'pl_1' });
```

Reusable sources can be created through `client.sources` (an alias of `client.ingestion`):

```ts
const web = await client.sources.createWeb('https://docs.example.com');
const drive = await client.sources.createGoogleDrive({ folderId: 'google-drive-folder-id' });
const confluence = await client.sources.createConfluence({ cloudId: 'cloud-id', accessToken: 'token', spaceKeys: ['DOCS'] });

// GitHub reads through the VectorAmp GitHub App, so no token is passed here.
// Install the app from the Sources page and use the installation id it reports.
const github = await client.sources.createGitHub({
  installationId: 42,
  repositories: ['acme/api', 'acme/web']
});

const gitlab = await client.sources.createGitLab({
  projects: ['mygroup/myproject'], // and/or groups: ['mygroup']
  authMode: 'token',               // defaults to 'oauth'
  accessToken: process.env.GITLAB_TOKEN
});

await dataset.ingestSource(web.id!);
```

GitHub and GitLab sources ingest repository files plus active branches,
pull/merge requests, and review discussions. Turn parts off with
`includePullRequests` / `includeMergeRequests`, `includeReviewThreads`, and
`includeDirectCommits`, and narrow file selection with `includeGlobs`,
`excludeGlobs`, and `maxFileSizeBytes`. Typed options are serialized into
`config` in snake_case.

Use `genericSource(sourceType, payload)` for source types not yet modeled by the SDK.

### Upload local files

`ingestFiles` hides the full presigned upload flow: it auto-creates a `file_upload` source,
initializes presigned uploads, PUTs each file, and completes the upload.

```ts
await dataset.ingestFiles(['./docs/intro.md', './docs/guide.pdf']);

// Walk a directory and upload matching text files.
await dataset.ingestFilesystem('./docs', {
  extensions: ['.md', '.txt'],
  maxBytesPerFile: 512_000
});
```

### Ingestion jobs

```ts
const job = await client.ingestion.startJob({ sourceId: 'src_1', datasetId: dataset.id });
const jobs = await client.ingestion.listJobs({ datasetId: dataset.id });
const detail = await client.ingestion.getJob(job.id!);
await client.ingestion.retryJob(job.id!);
```

## Intelligence / ask

```ts
const answer = await dataset.ask('What changed in the Q4 planning docs?');
console.log(answer.answer, answer.sources);

// Scope a question to any number of datasets with `datasetIds`.
const acrossTwo = await client.ask({
  query: 'Which contracts renew in Q4?',
  datasetIds: [dataset.id, 'ds_invoices']
});

// Omit `datasetIds` to query across every accessible dataset.
const acrossAll = await client.ask('Summarize everything about onboarding.');
```

Streaming uses Server-Sent Events:

```ts
for await (const event of client.askStream({ query: 'Summarize this dataset', datasetIds: [dataset.id] })) {
  if (event.event === 'done') break;
  console.log(event.data);
}
```

### Intelligence sessions

```ts
const session = await client.intelligence.createSession({ title: 'Planning', datasetId: dataset.id });
await client.intelligence.appendMessage(session.id, { role: 'user', content: 'Summarize the docs' });
const messages = await client.intelligence.listMessages(session.id, { limit: 100 });
```

Intelligence answers return `sources[]` and `chunks[]`. Inline `[1]` citations refer to
`sources[0]`; `preview_ref` / `previewRef` is an opaque preview token, not a storage key.

## Dataset documents

```ts
const page = await dataset.listDocuments({ limit: 50, status: 'ready' });
for (const document of page.data) console.log(document.id, document.file_name);

const bytes = await dataset.downloadDocument('document_id');
await writeFile('document.bin', Buffer.from(bytes));
```

## Schedules

```ts
const schedule = await client.schedules.create({
  sourceId: 'src_1',
  datasetId: dataset.id,
  cron: '0 2 * * *',
  timezone: 'UTC'
});
await client.schedules.trigger(schedule.id!);
```

## Method reference

Both `client.datasets.X(id, …)` and `datasetObj.X(…)` work for dataset-scoped methods.

### `client.datasets`
| Method | Required | Optional | HTTP |
|---|---|---|---|
| `list(params?)` | — | `limit`, `offset` | `GET /datasets` |
| `get(id)` | `id` | — | `GET /datasets/{id}` |
| `create(request)` | `name` | `dim`, `embedding`, `metric`, `hybrid`, `metadata` | `POST /datasets` |
| `delete(id)` | `id` | — | `DELETE /datasets/{id}` |
| `stats`/`listDocuments(id, params?)` | `id` | `limit`, `cursor`, `status` | `GET /datasets/{id}/documents` |
| `downloadDocument(id, docId)` | `id`, `docId` | — | `GET …/documents/{docId}/download` |
| `search(id, query)` | `id`, `query` | search options | `POST …/search` |
| `insert(id, vectors)` | `id`, `vectors` | — | `POST …/insert` |
| `addTexts(id, texts)` | `id`, `texts` | per-record `id`/`metadata` | embed + `POST …/insert` |
| `embed(id, …)` | `id` | — | `POST …/embed` |
| `ingestSource(id, source, options?)` | `id`, `source` | `pipelineId` | create-source? + `POST /ingestion/jobs` |
| `ingestFiles(id, paths, options?)` | `id`, `paths` | `sourceName`, `description`, `metadata` | presigned upload flow |
| `ingestFilesystem(id, root, options?)` | `id`, `root` | `extensions`, `maxBytesPerFile`, `sourceName`, `metadata` | presigned upload flow |

### `client.intelligence` (and `client.ask` / `client.askStream`)
| Method | Required | Optional | HTTP |
|---|---|---|---|
| `ask(request)` | `query` | `datasetIds` (omit for all), `topK`(5), `conversationHistory`, `includeSources` | `POST /intelligence/query` |
| `askStream(request)` | `query` | same as `ask` | `POST /intelligence/query` (SSE) |
| `createSession(input?)` | — | `title`, `workspaceId`, `datasetId`, `metadata` | `POST /intelligence/sessions` |
| `listSessions(params?)` | — | `limit` | `GET /intelligence/sessions` |
| `getSession(id)` | `id` | — | `GET /intelligence/sessions/{id}` |
| `appendMessage(sessionId, input)` | `sessionId`, `role`, `content` | `metadata` | `POST …/messages` |
| `listMessages(sessionId, params?)` | `sessionId` | `limit` | `GET …/messages` |

### `client.sources` / `client.ingestion`
| Method | Required | Optional | HTTP |
|---|---|---|---|
| `create(request)` | `source_type` | source config | `POST /ingestion/sources` |
| `createWeb/S3/Gcs/GoogleDrive/Jira/Confluence/GitHub/GitLab/FileUpload(input)` | per helper | per helper | `POST /ingestion/sources` |
| `list(params?)` | — | `limit`, `offset` | `GET /ingestion/sources` |
| `get(sourceId)` | `sourceId` | — | `GET /ingestion/sources/{id}` |
| `startJob(request)` | `sourceId`, `datasetId` | `pipelineId` | `POST /ingestion/jobs` |
| `listJobs(params?)` | — | `datasetId`, `limit`, `offset` | `GET /ingestion/jobs` |
| `getJob(jobId)` | `jobId` | — | `GET /ingestion/jobs/{id}` |
| `retryJob(jobId)` | `jobId` | — | `POST /ingestion/jobs/{id}/retry` |

### `client.schedules`
| Method | Required | Optional | HTTP |
|---|---|---|---|
| `list(params?)` | — | `limit`, `offset` | `GET /ingestion/schedules` |
| `get(id)` | `id` | — | `GET /ingestion/schedules/{id}` |
| `create(request)` | `sourceId`, `datasetId`, `cron` | `timezone`, `pipelineId`, `enabled`, `name`, `metadata` | `POST /ingestion/schedules` |
| `update(id, updates)` | `id` | all create fields | `PATCH /ingestion/schedules/{id}` |
| `delete(id)` | `id` | — | `DELETE /ingestion/schedules/{id}` |
| `trigger(id)` | `id` | — | `POST /ingestion/schedules/{id}/trigger` |

### Source helpers
`webSource`, `s3Source`, `gcsSource`, `googleDriveSource`, `jiraSource`, `confluenceSource`,
`fileUploadSource`, and `genericSource(sourceType, payload)`.

## Custom transport

The public transport interface keeps the SDK ready for gRPC or internal transports without
changing developer UX:

```ts
import type { Transport } from '@vectoramp/vectoramp';

const transport: Transport = {
  async request(method, path, options) {
    // REST, gRPC gateway, test double, etc.
    return {} as any;
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

## License

Apache-2.0. See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
