/** Proposed SPEC-rag-ingestion §6 contracts, ratified offline Stage A only. */
export const RAG_LIMITS = Object.freeze({
  MAX_RAW_BYTES: 5 * 1024 * 1024,
  MAX_NORMALIZED_CHARS: 1_000_000,
  MAX_CHUNKS_PER_VERSION: 2_000,
  HARD_MAX_CHUNK_TOKENS: 1_024,
  MAX_TOKENS_PER_JOB: 2_000_000,
  MAX_JOB_ATTEMPTS: 4,
} as const);

export type SourceMediaType = 'text/html' | 'text/markdown' | 'text/plain';
export type SourceExtractor = 'planalto-html@1' | 'dou-html@1' | 'markdown@1' | 'plaintext@1';

export type SourceManifestEntry = Readonly<{
  sourceId: string;
  tenantId: 'public';
  kind: 'http';
  canonicalUri: string;
  expectedMediaTypes: readonly SourceMediaType[];
  extractor: SourceExtractor;
  title: string;
  license: Readonly<{ kind: 'official-act-br' | 'cc-by-4.0' | 'other'; reference: string }>;
  language: 'pt-BR';
}>;

/** No network code is provided by Step B. Step C will produce this structure. */
export type FetchedDocument = Readonly<{
  sourceId: string;
  documentId: string;
  canonicalUri: string;
  finalUri: string;
  httpStatus: 200;
  declaredMediaType: string;
  sniffedMediaType: SourceMediaType;
  charset: string;
  byteSize: number;
  contentSha256: string;
  fetchedAt: string;
  bytes: Uint8Array;
}>;
