/** Fixed, sanitised codes. Never attach received documents, URLs or driver errors. */
export const RAG_CONTRACT_ERROR_CODES = [
  'INVALID_INPUT',
  'INVALID_MANIFEST_ENTRY',
  'INVALID_SOURCE_ID',
  'DUPLICATE_SOURCE',
  'UNSAFE_SOURCE_URL',
  'UNSUPPORTED_MEDIA_TYPE',
  'MEDIA_TYPE_MISMATCH',
  'EMPTY_CONTENT',
  'RAW_BYTES_EXCEEDED',
  'BINARY_CONTENT_REJECTED',
  'INVALID_HASH_COMPONENT',
  'INVALID_CANONICAL_JSON',
] as const;

export type RagContractErrorCode = (typeof RAG_CONTRACT_ERROR_CODES)[number];

export class RagContractError extends Error {
  readonly code: RagContractErrorCode;

  constructor(code: RagContractErrorCode) {
    super(code);
    this.name = 'RagContractError';
    this.code = code;
  }
}
