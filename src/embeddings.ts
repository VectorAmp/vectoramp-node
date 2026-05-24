export interface EmbeddingConfig {
  provider: string;
  model: string;
  secret_ref?: string;
}

export type OpenAIEmbeddingSize = 'small' | 'large';

export const VECTORAMP_EMBEDDING_4B = 'VectorAmp-Embedding-4B';
export const OPENAI_TEXT_EMBEDDING_3_SMALL = 'text-embedding-3-small';
export const OPENAI_TEXT_EMBEDDING_3_LARGE = 'text-embedding-3-large';

export const embeddingDimensions: Record<string, number> = {
  [VECTORAMP_EMBEDDING_4B]: 2560,
  [OPENAI_TEXT_EMBEDDING_3_SMALL]: 1536,
  [OPENAI_TEXT_EMBEDDING_3_LARGE]: 3072
};

export function openai(size: OpenAIEmbeddingSize = 'small'): EmbeddingConfig {
  return {
    provider: 'openai',
    model: size === 'large' ? OPENAI_TEXT_EMBEDDING_3_LARGE : OPENAI_TEXT_EMBEDDING_3_SMALL,
    secret_ref: 'emb:openai:api_key'
  };
}

export const embeddings = {
  vectoramp4B: { provider: 'vectoramp', model: VECTORAMP_EMBEDDING_4B } as EmbeddingConfig,
  openai,
  openaiSmall: openai('small'),
  openaiLarge: openai('large')
};
