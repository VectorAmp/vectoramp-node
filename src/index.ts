export { VectorAmpClient, VectorAmpClient as VectorAmp, createClient, DEFAULT_API_PREFIX, DEFAULT_BASE_URL } from './client.js';
export { DatasetResource, DatasetsClient } from './datasets.js';
export { IntelligenceClient } from './intelligence.js';
export { IngestionClient } from './ingestion.js';
export { SourcesClient, confluenceSource, fileUploadSource, genericSource, gcsSource, googleDriveSource, jiraSource, s3Source, webSource } from './sources.js';
export { RestTransport } from './transport.js';
export { VectorAmpError } from './errors.js';
export type * from './types.js';
