import { readFileSync } from 'node:fs';
import { canonicalJson, sha256 } from '../contracts/ids.ts';
import { RAG_LIMITS } from '../contracts/types.ts';
import { countH9Cl100kTokens, H9_PINNED_TOKENIZER } from '../processing/cl100k-counter.ts';
import { H9_TOKEN_GRID_PROFILES } from '../processing/token-grid.ts';
import { RagEmbeddingError } from './errors.ts';
import { EMBEDDING_JOB_MAX_BATCH_SIZE, planEmbeddingBatches, type DocumentEmbeddingInput } from './job.ts';
import type { EmbeddingProvider } from './provider.ts';
import { assertProviderMatchesSpace, requireEmbeddingSpace } from './space.ts';
import { H11_MVP_POLICY } from './spend-policy.ts';

export const E2_S512_PROFILE = H9_TOKEN_GRID_PROFILES.find(
  profile => profile.strategy === 'legal-structure' && profile.maxTokens === 512 && profile.overlapTokens === 0,
)!;
export const E2_MEASURED_TOKENIZER =
  `${H9_PINNED_TOKENIZER.encoding}/${H9_PINNED_TOKENIZER.packageName}@${H9_PINNED_TOKENIZER.version}` as const;

const CHUNK_HASH = /^[a-f0-9]{64}$/;
const SPACE = requireEmbeddingSpace('chunks_te3s_1536_v1');
let verifiedTokenizerVersion = false;

function verifyTokenizerVersion(): void {
  if (verifiedTokenizerVersion) return;
  try {
    // The pinned package's module entry is dist/index.js. Its manifest is
    // private to the package exports, so resolve it relative to that entry.
    const entry = import.meta.resolve(H9_PINNED_TOKENIZER.packageName);
    const manifest = new URL('../package.json', entry);
    const pkg = JSON.parse(readFileSync(manifest, 'utf8')) as { name?: string; version?: string };
    verifiedTokenizerVersion = pkg.name === H9_PINNED_TOKENIZER.packageName &&
      pkg.version === H9_PINNED_TOKENIZER.version;
  } catch {
    throw new RagEmbeddingError('EMBED_TOKENIZER_MISMATCH');
  }
  if (!verifiedTokenizerVersion) throw new RagEmbeddingError('EMBED_TOKENIZER_MISMATCH');
}

export type MeasuredEmbeddingChunk = DocumentEmbeddingInput & Readonly<{
  tokens: number;
  bytes: number;
}>;

export type MeasuredEmbeddingBatch = Readonly<{
  chunks: readonly MeasuredEmbeddingChunk[];
  tokens: number;
  hash: string;
}>;

export type MeasuredEmbeddingPlan = Readonly<{
  spaceId: string;
  measuredTokenizer: typeof E2_MEASURED_TOKENIZER;
  chunks: readonly MeasuredEmbeddingChunk[];
  batches: readonly MeasuredEmbeddingBatch[];
  totalTokens: number;
  worstCaseTokenReservation: number;
}>;

/** Count the complete immutable input that will actually be sent to the provider. */
export function prepareMeasuredEmbeddingPlan(
  provider: EmbeddingProvider,
  inputs: readonly DocumentEmbeddingInput[],
  existingChunkIds: readonly string[] = [],
): MeasuredEmbeddingPlan {
  assertProviderMatchesSpace(provider, SPACE);
  if (!Number.isSafeInteger(provider.maxInputsPerCall) || provider.maxInputsPerCall < 1 ||
      !Number.isSafeInteger(provider.maxInputTokens) || provider.maxInputTokens < 1 ||
      !Array.isArray(inputs) || inputs.length > RAG_LIMITS.MAX_CHUNKS_PER_VERSION ||
      !Array.isArray(existingChunkIds)) {
    throw new RagEmbeddingError('EMBED_INVALID_INPUT');
  }

  verifyTokenizerVersion();
  const seen = new Set<string>();
  const maxInputTokens = Math.min(E2_S512_PROFILE.maxTokens,
    RAG_LIMITS.HARD_MAX_CHUNK_TOKENS, provider.maxInputTokens);
  const chunks = inputs.map(chunk => {
    const chunkId = chunk?.chunkId;
    const input = chunk?.text;
    if (typeof chunkId !== 'string' || !CHUNK_HASH.test(chunkId) || seen.has(chunkId) || typeof input !== 'string' || input.includes('\0')) {
      throw new RagEmbeddingError('EMBED_INVALID_INPUT');
    }
    const text = input;
    let tokens: number;
    try {
      tokens = countH9Cl100kTokens(text);
    } catch {
      throw new RagEmbeddingError('EMBED_INVALID_INPUT');
    }
    if (tokens > maxInputTokens) throw new RagEmbeddingError('EMBED_INVALID_INPUT');
    seen.add(chunkId);
    return Object.freeze({ chunkId, text, tokens, bytes: Buffer.byteLength(text, 'utf8') });
  });

  const existing = new Set(existingChunkIds);
  if (existing.size !== existingChunkIds.length || existingChunkIds.some(id => !seen.has(id))) {
    throw new RagEmbeddingError('EMBED_INVALID_INPUT');
  }

  const { batches, totalTokens, worstCaseTokenReservation } = planEmbeddingBatches(
    chunks.filter(chunk => !existing.has(chunk.chunkId)),
    chunk => chunk.tokens, Math.min(provider.maxInputsPerCall, EMBEDDING_JOB_MAX_BATCH_SIZE),
  );
  if (worstCaseTokenReservation > H11_MVP_POLICY.maxJobReservedTokens) {
    throw new RagEmbeddingError('EMBED_BUDGET_EXCEEDED');
  }

  return Object.freeze({
    spaceId: SPACE.spaceId,
    measuredTokenizer: E2_MEASURED_TOKENIZER,
    chunks: Object.freeze(chunks),
    batches: Object.freeze(batches.map(batch => Object.freeze({
      chunks: Object.freeze(batch.chunks),
      tokens: batch.tokens,
      hash: sha256(canonicalJson({
        version: 'rag:embedding-batch:v1',
        spaceId: SPACE.spaceId,
        tokenizer: E2_MEASURED_TOKENIZER,
        inputs: batch.chunks.map(chunk => [chunk.chunkId, chunk.text]),
      })),
    }))),
    totalTokens,
    worstCaseTokenReservation,
  });
}
