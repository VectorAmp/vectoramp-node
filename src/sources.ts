import type {
  ConfluenceSourceOptions,
  FileUploadSourceOptions,
  GcsSourceOptions,
  GoogleDriveSourceOptions,
  IngestionSource,
  IngestionSourceInput,
  JiraSourceOptions,
  S3SourceOptions,
  SourceCreateInput,
  SourceType,
  Transport,
  WebSourceOptions
} from './types.js';
import { toSnakeCasePayload } from './utils.js';

/**
 * Build a web ingestion source payload.
 *
 * @param input - URL string or web source options. `url` is accepted as an alias for `uri`.
 * @returns Source creation input with `source_type: "web"`.
 */
export function webSource(input: string | WebSourceOptions): IngestionSourceInput {
  if (typeof input === 'string') return { source_type: 'web', uri: input };
  const { url, uri = url, ...rest } = input;
  return { ...rest, source_type: 'web', uri };
}

/**
 * Build an S3 ingestion source payload.
 *
 * @param input - S3 URI string or S3 source options.
 * @returns Source creation input with `source_type: "s3"`.
 */
export function s3Source(input: string | S3SourceOptions): IngestionSourceInput {
  if (typeof input === 'string') return { source_type: 's3', uri: input };
  return { ...input, source_type: 's3' };
}

/**
 * Build a Google Cloud Storage ingestion source payload.
 *
 * @param input - GCS URI string or GCS source options.
 * @returns Source creation input with `source_type: "gcs"`.
 */
export function gcsSource(input: string | GcsSourceOptions): IngestionSourceInput {
  if (typeof input === 'string') return { source_type: 'gcs', uri: input };
  return { ...input, source_type: 'gcs' };
}

/**
 * Build a Google Drive ingestion source payload.
 *
 * @param input - Drive URI/id string or Google Drive source options.
 * @returns Source creation input with `source_type: "gdrive"`.
 */
export function googleDriveSource(input: string | GoogleDriveSourceOptions): IngestionSourceInput {
  if (typeof input === 'string') return { source_type: 'gdrive', uri: input };
  return { ...input, source_type: 'gdrive' };
}

/**
 * Build a local file-upload ingestion source payload.
 *
 * @param input - File upload source options. `name` defaults to `Local file upload`.
 * @returns Source creation input with `source_type: "file_upload"`.
 */
export function fileUploadSource(input: FileUploadSourceOptions = {}): IngestionSourceInput {
  return { name: 'Local file upload', ...input, source_type: 'file_upload' };
}

/**
 * Build a Jira ingestion source payload.
 *
 * @param input - Jira source options, usually populated from the Atlassian browser OAuth flow.
 * @returns Source creation input with `source_type: "jira"`.
 */
export function jiraSource(input: JiraSourceOptions): IngestionSourceInput {
  return { includeComments: true, ...input, source_type: 'jira' };
}

/**
 * Build a Confluence ingestion source payload.
 *
 * @param input - Confluence source options, usually populated from the Atlassian browser OAuth flow.
 * @returns Source creation input with `source_type: "confluence"`.
 */
export function confluenceSource(input: ConfluenceSourceOptions): IngestionSourceInput {
  return { ...input, source_type: 'confluence' };
}

/**
 * Build a source payload for any supported or custom source type.
 *
 * @param sourceType - Source type string.
 * @param input - Source properties to include.
 * @returns Source creation input with the requested `source_type`.
 */
export function genericSource(sourceType: SourceType | (string & {}), input: Record<string, unknown> = {}): IngestionSourceInput {
  return { ...input, source_type: sourceType };
}

/** Ingestion source creation API client. */
export class SourcesClient {
  constructor(private readonly transport: Transport) {}

  /**
   * Create an ingestion source.
   *
   * @param request - Source creation payload.
   * @returns The created source.
   */
  create(request: SourceCreateInput): Promise<IngestionSource> {
    return this.transport.request<IngestionSource>('POST', '/ingestion/sources', {
      body: toSnakeCasePayload(request)
    });
  }

  /**
   * Create a web ingestion source.
   *
   * @param input - URL string or web source options.
   * @returns The created source.
   */
  createWeb(input: string | WebSourceOptions): Promise<IngestionSource> {
    return this.create(webSource(input));
  }

  /**
   * Create an S3 ingestion source.
   *
   * @param input - S3 URI string or S3 source options.
   * @returns The created source.
   */
  createS3(input: string | S3SourceOptions): Promise<IngestionSource> {
    return this.create(s3Source(input));
  }

  /**
   * Create a Google Cloud Storage ingestion source.
   *
   * @param input - GCS URI string or GCS source options.
   * @returns The created source.
   */
  createGcs(input: string | GcsSourceOptions): Promise<IngestionSource> {
    return this.create(gcsSource(input));
  }

  /**
   * Create a Google Drive ingestion source.
   *
   * @param input - Drive URI/id string or Google Drive source options.
   * @returns The created source.
   */
  createGoogleDrive(input: string | GoogleDriveSourceOptions): Promise<IngestionSource> {
    return this.create(googleDriveSource(input));
  }

  /**
   * Create a local file-upload ingestion source.
   *
   * @param input - File upload source options. `name` defaults to `Local file upload`.
   * @returns The created source.
   */
  createFileUpload(input: FileUploadSourceOptions = {}): Promise<IngestionSource> {
    return this.create(fileUploadSource(input));
  }

  /**
   * Create a Jira ingestion source.
   *
   * @param input - Jira source options.
   * @returns The created source.
   */
  createJira(input: JiraSourceOptions): Promise<IngestionSource> {
    return this.create(jiraSource(input));
  }

  /**
   * Create a Confluence ingestion source.
   *
   * @param input - Confluence source options.
   * @returns The created source.
   */
  createConfluence(input: ConfluenceSourceOptions): Promise<IngestionSource> {
    return this.create(confluenceSource(input));
  }
}
