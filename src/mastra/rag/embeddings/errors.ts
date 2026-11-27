/** Fixed error codes only: never attach raw chunk text, API errors or credentials. */
export const EMBEDDING_ERROR_CODES = [
  'EMBED_INVALID_INPUT',
  'EMBED_INVALID_SPACE',
  'EMBED_PAID_NOT_AUTHORIZED',
  'EMBED_CREDENTIAL_UNAVAILABLE',
  'EMBED_TRANSPORT_CONFIG_INVALID',
  'EMBED_BUDGET_EXCEEDED',
  'EMBED_ABORTED',
  'EMBED_PROVIDER_FAILURE',
  'EMBED_PROVIDER_TRANSIENT',
  'EMBED_RETRY_EXHAUSTED',
  'EMBED_CALL_LIMIT_REACHED',
  'EMBED_RETRY_DELAY_EXCEEDED',
  'EMBED_DIMENSION_MISMATCH',
  'EMBED_NONFINITE_VECTOR',
  'EMBED_USAGE_INVALID',
  'EMBED_TOKENIZER_MISMATCH',
  'EMBED_RESERVATION_MISMATCH',
  'EMBED_RESERVATION_CLOSED',
  'EMBED_RESERVATION_EXPIRED',
  'EMBED_RECONCILIATION_REQUIRED',
] as const;

export type EmbeddingErrorCode = (typeof EMBEDDING_ERROR_CODES)[number];

export class RagEmbeddingError extends Error {
  readonly code: EmbeddingErrorCode;
  readonly retryable: boolean;
  readonly retryAfterMs: number | null;

  readonly reportedTokens: number | null;

  constructor(code: EmbeddingErrorCode, options: {
    retryable?: boolean;
    retryAfterMs?: number;
    reportedTokens?: number;
  } = {}) {
    super(code);
    this.name = 'RagEmbeddingError';
    this.code = code;
    this.retryable = options.retryable === true;
    this.reportedTokens = Number.isSafeInteger(options.reportedTokens) &&
      options.reportedTokens! > 0 ? options.reportedTokens! : null;
    this.retryAfterMs = Number.isSafeInteger(options.retryAfterMs) &&
      options.retryAfterMs! >= 0 ? options.retryAfterMs! : null;
  }
}
