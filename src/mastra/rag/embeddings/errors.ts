/** Fixed error codes only: never attach raw chunk text, API errors or credentials. */
export const EMBEDDING_ERROR_CODES = [
  'EMBED_INVALID_INPUT',
  'EMBED_INVALID_SPACE',
  'EMBED_PAID_NOT_AUTHORIZED',
  'EMBED_BUDGET_EXCEEDED',
  'EMBED_ABORTED',
  'EMBED_PROVIDER_FAILURE',
  'EMBED_PROVIDER_TRANSIENT',
  'EMBED_RETRY_EXHAUSTED',
  'EMBED_RETRY_DELAY_EXCEEDED',
  'EMBED_DIMENSION_MISMATCH',
  'EMBED_NONFINITE_VECTOR',
  'EMBED_USAGE_INVALID',
] as const;

export type EmbeddingErrorCode = (typeof EMBEDDING_ERROR_CODES)[number];

export class RagEmbeddingError extends Error {
  readonly code: EmbeddingErrorCode;
  readonly retryable: boolean;
  readonly retryAfterMs: number | null;

  constructor(code: EmbeddingErrorCode, options: { retryable?: boolean; retryAfterMs?: number } = {}) {
    super(code);
    this.name = 'RagEmbeddingError';
    this.code = code;
    this.retryable = options.retryable === true;
    this.retryAfterMs = Number.isSafeInteger(options.retryAfterMs) &&
      options.retryAfterMs! >= 0 ? options.retryAfterMs! : null;
  }
}
