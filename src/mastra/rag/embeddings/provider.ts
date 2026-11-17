import { RagEmbeddingError } from './errors.ts';

export type EmbeddingPurpose = 'document' | 'query';

export type EmbeddingProvider = Readonly<{
  readonly spaceId: string;
  readonly dimension: number;
  readonly maxInputsPerCall: number;
  readonly maxInputTokens: number;
  readonly providerOptions?: Readonly<Record<string, unknown>>;
  embed(
    inputs: readonly string[],
    options: { signal: AbortSignal; purpose: EmbeddingPurpose },
  ): Promise<{ vectors: number[][]; usage: { tokens: number } }>;
}>;

/**
 * Validate the entire embedding response BEFORE any persistence layer can
 * receive a vector. An invalid batch is discarded atomically.
 */
export function validateEmbeddingVectors(
  vectors: unknown, expectedInputs: number, dimension: number,
): number[][] {
  if (!Array.isArray(vectors) || vectors.length !== expectedInputs ||
      !Number.isSafeInteger(dimension) || dimension <= 0 || dimension > 2000) {
    throw new RagEmbeddingError('EMBED_DIMENSION_MISMATCH');
  }
  const copy: number[][] = [];
  for (const vector of vectors) {
    if (!Array.isArray(vector) || vector.length !== dimension) {
      throw new RagEmbeddingError('EMBED_DIMENSION_MISMATCH');
    }
    const values: number[] = [];
    for (const value of vector) {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new RagEmbeddingError('EMBED_NONFINITE_VECTOR');
      }
      values.push(value);
    }
    copy.push(values);
  }
  return copy;
}

export function requireEmbeddingUsage(usage: unknown): number {
  if (!usage || typeof usage !== 'object') {
    throw new RagEmbeddingError('EMBED_USAGE_INVALID');
  }
  let tokens: unknown;
  try { tokens = (usage as Record<string, unknown>).tokens; }
  catch { throw new RagEmbeddingError('EMBED_USAGE_INVALID'); }
  if (typeof tokens !== 'number' || !Number.isSafeInteger(tokens) || tokens < 0) {
    throw new RagEmbeddingError('EMBED_USAGE_INVALID');
  }
  return tokens;
}
