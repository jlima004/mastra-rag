import { RagEmbeddingError } from './errors.ts';

export type EmbeddingSpace = Readonly<{
  spaceId: string;
  provider: 'openai' | 'google';
  embeddingModel: string;
  embeddingVersion: number;
  dimension: number;
  metric: 'cosine';
  vectorType: 'vector';
  status: 'building' | 'active' | 'retiring' | 'retired';
}>;

const MVP_SPACE: EmbeddingSpace = Object.freeze({
  spaceId: 'chunks_te3s_1536_v1',
  provider: 'openai',
  embeddingModel: 'text-embedding-3-small',
  embeddingVersion: 1,
  dimension: 1536,
  metric: 'cosine',
  vectorType: 'vector',
  // NOT an operationally active vector index: DB provisioning is Step E1.
  status: 'building',
});

export const EMBEDDING_SPACES: Readonly<Record<string, EmbeddingSpace>> = Object.freeze({
  [MVP_SPACE.spaceId]: MVP_SPACE,
});

const ID_PATTERN = /^chunks_[a-z0-9_]{1,33}$/;

/** This is an in-code contract registry, NOT a database-backed active-space pointer. */
export function requireEmbeddingSpace(spaceId: string): EmbeddingSpace {
  if (typeof spaceId !== 'string' || !ID_PATTERN.test(spaceId) ||
      !Object.hasOwn(EMBEDDING_SPACES, spaceId)) {
    throw new RagEmbeddingError('EMBED_INVALID_SPACE');
  }
  return EMBEDDING_SPACES[spaceId];
}

export function assertProviderMatchesSpace(
  provider: { spaceId: string; dimension: number }, space: EmbeddingSpace,
): void {
  if (provider.spaceId !== space.spaceId || provider.dimension !== space.dimension ||
      !Number.isSafeInteger(space.dimension) || space.dimension < 1 ||
      space.dimension > 2000 || space.metric !== 'cosine' || space.vectorType !== 'vector') {
    throw new RagEmbeddingError('EMBED_INVALID_SPACE');
  }
}
