/** Stable Step C errors. Never forward source text, URLs or driver messages. */
export const PROCESSING_ERROR_CODES = [
  'FETCH_UNSAFE_ADDRESS', 'FETCH_DNS_FAILED', 'FETCH_TIMEOUT',
  'FETCH_HTTP_STATUS', 'FETCH_REDIRECT_REJECTED', 'FETCH_REDIRECT_LIMIT',
  'FETCH_BYTES_EXCEEDED', 'FETCH_INVALID_RESPONSE',
  'DECODE_INVALID_CHARSET', 'DECODE_CHARSET_CONFLICT',
  'EXTRACT_UNSUPPORTED_HTML', 'EXTRACT_UNSUPPORTED_ENTITY', 'EXTRACT_EMPTY',
  'NORMALIZED_TOO_LARGE', 'INVALID_DOCUMENT',
  'CHUNK_EMPTY', 'CHUNK_TOO_LARGE', 'CHUNK_HEADER_TOO_LARGE',
  'CHUNK_BUDGET_EXCEEDED',
] as const;

export type ProcessingErrorCode = (typeof PROCESSING_ERROR_CODES)[number];

export class RagProcessingError extends Error {
  readonly code: ProcessingErrorCode;
  constructor(code: ProcessingErrorCode) {
    super(code);
    this.name = 'RagProcessingError';
    this.code = code;
  }
}
