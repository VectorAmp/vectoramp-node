import type { OpenAISecretStatus, Transport } from './types.js';

/** OpenAI org-secret reference used by VectorAmp embedding datasets. */
export const OPENAI_API_KEY_SECRET_REF = 'emb:openai:api_key';

/** Organization-scoped secret helpers. */
export class OrgSecretsClient {
  constructor(private readonly transport: Transport) {}

  put(name: string, value: string): Promise<void> {
    if (!name) throw new Error('Secret name is required');
    if (!value) throw new Error('Secret value is required');
    return this.transport.request<void>('PUT', `/org-secrets/${encodeURIComponent(name)}`, { body: { value } });
  }

  async exists(name: string): Promise<boolean> {
    try {
      await this.transport.request<void>('GET', `/org-secrets/${encodeURIComponent(name)}`);
      return true;
    } catch (error) {
      if (error && typeof error === 'object' && 'status' in error && (error as { status?: number }).status === 404) return false;
      throw error;
    }
  }

  /**
   * Save or replace the current organization's OpenAI API key.
   *
   * The server stores this as the org secret referenced by
   * `embedding.secret_ref = "emb:openai:api_key"`; the plaintext key is never
   * returned by the API.
   *
   * @param apiKey - OpenAI API key to store for this organization.
   */
  putOpenAIApiKey(apiKey: string): Promise<void> {
    if (!apiKey) throw new Error('OpenAI API key is required');
    return this.put(OPENAI_API_KEY_SECRET_REF, apiKey);
  }

  /** Alias for {@link putOpenAIApiKey}; org secrets are upserted server-side. */
  updateOpenAIApiKey(apiKey: string): Promise<void> {
    return this.putOpenAIApiKey(apiKey);
  }

  /**
   * Check whether the current organization has a saved OpenAI API key.
   *
   * @returns `{ exists: true }` when present; `{ exists: false }` for a 404.
   */
  async hasOpenAIApiKey(): Promise<OpenAISecretStatus> {
    try {
      return { exists: await this.exists(OPENAI_API_KEY_SECRET_REF), secretRef: OPENAI_API_KEY_SECRET_REF };
    } catch (error) {
      throw error;
    }
  }
}
