import type {
  FileUploadSourceOptions,
  GoogleDriveSourceOptions,
  IngestionSource,
  IngestionSourceInput,
  S3SourceOptions,
  SourceCreateInput,
  SourceType,
  Transport,
  WebSourceOptions
} from './types.js';
import { toSnakeCasePayload } from './utils.js';

export function webSource(input: string | WebSourceOptions): IngestionSourceInput {
  if (typeof input === 'string') return { source_type: 'web', uri: input };
  const { url, uri = url, ...rest } = input;
  return { ...rest, source_type: 'web', uri };
}

export function s3Source(input: string | S3SourceOptions): IngestionSourceInput {
  if (typeof input === 'string') return { source_type: 's3', uri: input };
  return { ...input, source_type: 's3' };
}

export function googleDriveSource(input: string | GoogleDriveSourceOptions): IngestionSourceInput {
  if (typeof input === 'string') return { source_type: 'gdrive', uri: input };
  return { ...input, source_type: 'gdrive' };
}

export function fileUploadSource(input: FileUploadSourceOptions = {}): IngestionSourceInput {
  return { ...input, source_type: 'file_upload' };
}

export function genericSource(sourceType: SourceType | (string & {}), input: Record<string, unknown> = {}): IngestionSourceInput {
  return { ...input, source_type: sourceType };
}

export class SourcesClient {
  constructor(private readonly transport: Transport) {}

  create(request: SourceCreateInput): Promise<IngestionSource> {
    return this.transport.request<IngestionSource>('POST', '/ingestion/sources', {
      body: toSnakeCasePayload(request)
    });
  }

  createWeb(input: string | WebSourceOptions): Promise<IngestionSource> {
    return this.create(webSource(input));
  }

  createS3(input: string | S3SourceOptions): Promise<IngestionSource> {
    return this.create(s3Source(input));
  }

  createGoogleDrive(input: string | GoogleDriveSourceOptions): Promise<IngestionSource> {
    return this.create(googleDriveSource(input));
  }

  createFileUpload(input: FileUploadSourceOptions = {}): Promise<IngestionSource> {
    return this.create(fileUploadSource(input));
  }
}
