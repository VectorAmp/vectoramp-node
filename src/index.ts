export { VectorAmpClient, VectorAmpClient as VectorAmp, createClient, DEFAULT_API_PREFIX, DEFAULT_BASE_URL } from './client.js';
export { ConnectionsClient } from './connections.js';
export { DatasetResource, DatasetsClient } from './datasets.js';
export {
  embeddings,
  embeddingDimensions,
  openai,
  OPENAI_TEXT_EMBEDDING_3_LARGE,
  OPENAI_TEXT_EMBEDDING_3_SMALL,
  VECTORAMP_EMBEDDING_4B
} from './embeddings.js';
export { IntelligenceClient } from './intelligence.js';
export { IngestionClient } from './ingestion.js';
export { OPENAI_API_KEY_SECRET_REF, OrgSecretsClient } from './org-secrets.js';
export type { ListJobsParams, StartJobRequest } from './ingestion.js';
export { SchedulesClient } from './schedules.js';
export { SourcesClient, confluenceSource, fileUploadSource, genericSource, gcsSource, googleDriveSource, jiraSource, s3Source, webSource } from './sources.js';
export { RestTransport } from './transport.js';
export { VectorAmpError } from './errors.js';
export type * from './types.js';
