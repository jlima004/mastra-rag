import { setTimeout as sleepWithAbort } from 'node:timers/promises';
import { RAG_LIMITS } from '../contracts/types.ts';
import { RagEmbeddingError } from './errors.ts';
import type { EmbeddingProvider } from './provider.ts';
import { requireEmbeddingUsage, validateEmbeddingVectors } from './provider.ts';
import { assertProviderMatchesSpace, requireEmbeddingSpace } from './space.ts';

export type DocumentEmbeddingInput = Readonly<{
  chunkId: string;
  text: string;
}>;

export type EmbeddingJobArguments = Readonly<{
  provider: EmbeddingProvider;
  chunks: readonly DocumentEmbeddingInput[];
  /** Step E will obtain this list using namespace-scoped, published-safe queries. */
  existingChunkIds?: readonly string[];
  signal: AbortSignal;
  /** Must never exceed the immutable project hard cap. */
  tokenBudget: number;
  /** Caller-supplied remaining daily allowance; H11 still required for paid use. */
  remainingDailyTokens: number;
}>;

export type EmbeddingJobPlan = Readonly<{
  spaceId: string;
  missingCount: number;
  skippedCount: number;
  batchCount: number;
  maxProviderCalls: number;
  /** Conservative upper bound based on UTF-8 bytes plus eight per input. */
  estimatedTokenUpperBound: number;
  /** Initial batches plus three globally budgeted retry calls. */
  worstCaseTokenReservation: number;
  batchSize: number;
}>;

export type EmbeddedDocumentChunk = Readonly<{
  chunkId: string;
  vector: readonly number[];
}>;

export type EmbeddingJobResult = Readonly<{
  plan: EmbeddingJobPlan;
  embedded: readonly EmbeddedDocumentChunk[];
  providerCalls: number;
  retriesUsed: number;
  reservedTokenUpperBound: number;
  reportedUsageTokens: number;
}>;

export type EmbeddingJobExecution = Readonly<{
  sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  /** Injected ONLY for deterministic offline tests. */
  random?: () => number;
}>;

type Batch = Readonly<{ chunks: readonly DocumentEmbeddingInput[]; upperBound: number }>;
type PreparedPlan = Readonly<{ plan: EmbeddingJobPlan; batches: readonly Batch[] }>;
const HASH_ID = /^[0-9a-f]{64}$/;
const MAX_BATCH_SIZE = 128;
const MAX_RETRY_DELAY_MS = 30_000;

function assertReady(signal: AbortSignal): void {
  if (signal.aborted) throw new RagEmbeddingError('EMBED_ABORTED');
}

/**
 * Conservative billing reservation for BPE-style UTF-8 inputs, NOT a
 * measured cl100k_base token count. Never relabel this as token calibration.
 * The +8 covers small model wrapper overhead; exact tokenization is H9.
 */
export function conservativeInputTokenUpperBound(text: string): number {
  if (typeof text !== 'string' || !text.trim() ||
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(text)) {
    throw new RagEmbeddingError('EMBED_INVALID_INPUT');
  }
  const count = Buffer.byteLength(text, 'utf8') + 8;
  if (!Number.isSafeInteger(count)) throw new RagEmbeddingError('EMBED_INVALID_INPUT');
  return count;
}

function isBudget(n: unknown): n is number {
  return typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 &&
    n <= RAG_LIMITS.MAX_TOKENS_PER_JOB;
}

function prepare(args: EmbeddingJobArguments): PreparedPlan {
  if (!args || !(args.signal instanceof AbortSignal) ||
      !isBudget(args.tokenBudget) || args.tokenBudget === 0 ||
      !isBudget(args.remainingDailyTokens) ||
      !args.provider || !Array.isArray(args.chunks) ||
      args.chunks.length > RAG_LIMITS.MAX_CHUNKS_PER_VERSION) {
    throw new RagEmbeddingError('EMBED_INVALID_INPUT');
  }
  const space = requireEmbeddingSpace(args.provider.spaceId);
  assertProviderMatchesSpace(args.provider, space);
  if (!Number.isSafeInteger(args.provider.maxInputsPerCall) ||
      args.provider.maxInputsPerCall < 1 ||
      !Number.isSafeInteger(args.provider.maxInputTokens) ||
      args.provider.maxInputTokens < 1) {
    throw new RagEmbeddingError('EMBED_INVALID_INPUT');
  }
  const batchSize = Math.min(args.provider.maxInputsPerCall, MAX_BATCH_SIZE);
  const seen = new Set<string>();
  for (const c of args.chunks) {
    if (!c || typeof c.chunkId !== 'string' || !HASH_ID.test(c.chunkId) ||
        seen.has(c.chunkId)) {
      throw new RagEmbeddingError('EMBED_INVALID_INPUT');
    }
    seen.add(c.chunkId);
    const upper = conservativeInputTokenUpperBound(c.text);
    if (upper > RAG_LIMITS.HARD_MAX_CHUNK_TOKENS || upper > args.provider.maxInputTokens) {
      throw new RagEmbeddingError('EMBED_INVALID_INPUT');
    }
  }
  const existing = args.existingChunkIds ?? [];
  if (!Array.isArray(existing) || new Set(existing).size !== existing.length ||
      existing.some(id => typeof id !== 'string' || !seen.has(id))) {
    throw new RagEmbeddingError('EMBED_INVALID_INPUT');
  }
  const present = new Set(existing);
  const missing = args.chunks.filter(chunk => !present.has(chunk.chunkId));
  const batches: Batch[] = [];
  let estimatedTokenUpperBound = 0;
  for (let i = 0; i < missing.length; i += batchSize) {
    const group = missing.slice(i, i + batchSize);
    const upper = group.reduce((sum, c) =>
      sum + conservativeInputTokenUpperBound(c.text), 0);
    estimatedTokenUpperBound += upper;
    batches.push({ chunks: group, upperBound: upper });
  }
  const worstBatch = Math.max(0, ...batches.map(b => b.upperBound));
  // One initial call per nonempty batch; at most three retries FOR THE JOB.
  const retriesAvailable = batches.length ? RAG_LIMITS.MAX_JOB_ATTEMPTS - 1 : 0;
  const worstCaseTokenReservation =
    estimatedTokenUpperBound + retriesAvailable * worstBatch;
  if (worstCaseTokenReservation > args.tokenBudget ||
      worstCaseTokenReservation > args.remainingDailyTokens) {
    throw new RagEmbeddingError('EMBED_BUDGET_EXCEEDED');
  }
  return {
    plan: Object.freeze({
      spaceId: space.spaceId,
      missingCount: missing.length,
      skippedCount: args.chunks.length - missing.length,
      batchCount: batches.length,
      maxProviderCalls: batches.length + retriesAvailable,
      estimatedTokenUpperBound,
      worstCaseTokenReservation,
      batchSize,
    }),
    batches,
  };
}

/** Pure preflight; never accesses credentials, network or database. */
export function planEmbeddingJob(args: EmbeddingJobArguments): EmbeddingJobPlan {
  return prepare(args).plan;
}

function backoffMs(retriesUsed: number, random: () => number, retryAfterMs: number | null): number {
  const draw = random();
  if (typeof draw !== 'number' || !Number.isFinite(draw) || draw < 0 || draw >= 1) {
    throw new RagEmbeddingError('EMBED_INVALID_INPUT');
  }
  const exponential = Math.min(MAX_RETRY_DELAY_MS, 1000 * 2 ** retriesUsed);
  const jitter = Math.floor(exponential * draw);
  if (retryAfterMs !== null && retryAfterMs > MAX_RETRY_DELAY_MS) {
    // Never ignore a provider-mandated wait to force a fast retry.
    throw new RagEmbeddingError('EMBED_RETRY_DELAY_EXCEEDED');
  }
  return Math.max(jitter, retryAfterMs ?? 0);
}

/**
 * Returns validated vectors for later, explicitly authorized persistence.
 * Runs sequentially (<= the SPEC's max two concurrent provider calls).
 * No partial result is returned after failure; no vector store is touched.
 */
export async function embedMissingDocumentChunks(
  args: EmbeddingJobArguments, execution: EmbeddingJobExecution = {},
): Promise<EmbeddingJobResult> {
  const prepared = prepare(args);
  assertReady(args.signal);
  const random = execution.random ?? Math.random;
  const sleep = execution.sleep ??
    (async (milliseconds: number, signal: AbortSignal) => {
      await sleepWithAbort(milliseconds, undefined, { signal });
    });
  const embedded: EmbeddedDocumentChunk[] = [];
  let providerCalls = 0;
  let retriesUsed = 0;
  let reservedTokenUpperBound = 0;
  let reportedUsageTokens = 0;

  for (const batch of prepared.batches) {
    while (true) {
      assertReady(args.signal);
      // Reserve EVERY attempt, including failed 429/5xx calls whose billing is
      // unknown. Preflight already guarantees enough room for all 3 retries.
      reservedTokenUpperBound += batch.upperBound;
      if (reservedTokenUpperBound > args.tokenBudget ||
          reservedTokenUpperBound > args.remainingDailyTokens ||
          providerCalls >= prepared.plan.maxProviderCalls) {
        throw new RagEmbeddingError('EMBED_BUDGET_EXCEEDED');
      }
      providerCalls += 1;
      let response: Awaited<ReturnType<EmbeddingProvider['embed']>>;
      try {
        response = await args.provider.embed(
          batch.chunks.map(chunk => chunk.text),
          { signal: args.signal, purpose: 'document' },
        );
      } catch (error) {
        if (args.signal.aborted) throw new RagEmbeddingError('EMBED_ABORTED');
        const failure = error instanceof RagEmbeddingError
          ? error : new RagEmbeddingError('EMBED_PROVIDER_FAILURE');
        if (!failure.retryable) throw failure;
        if (retriesUsed >= RAG_LIMITS.MAX_JOB_ATTEMPTS - 1) {
          throw new RagEmbeddingError('EMBED_RETRY_EXHAUSTED');
        }
        const wait = backoffMs(retriesUsed, random, failure.retryAfterMs);
        retriesUsed += 1;
        assertReady(args.signal);
        try { await sleep(wait, args.signal); }
        catch { throw new RagEmbeddingError('EMBED_ABORTED'); }
        continue;
      }
      assertReady(args.signal);
      if (!response || typeof response !== 'object') {
        throw new RagEmbeddingError('EMBED_PROVIDER_FAILURE');
      }
      const vectors = validateEmbeddingVectors(
        response.vectors, batch.chunks.length, args.provider.dimension,
      );
      const reported = requireEmbeddingUsage(response.usage);
      if (reported > batch.upperBound) {
        // Conservative envelope failed to cover reported tokens: stop before
        // any future call/persistence and require a revised token policy.
        throw new RagEmbeddingError('EMBED_USAGE_INVALID');
      }
      reportedUsageTokens += reported;
      for (let i = 0; i < batch.chunks.length; i++) {
        embedded.push(Object.freeze({
          chunkId: batch.chunks[i].chunkId,
          vector: Object.freeze(vectors[i]),
        }));
      }
      break;
    }
  }
  return Object.freeze({
    plan: prepared.plan,
    embedded: Object.freeze(embedded),
    providerCalls,
    retriesUsed,
    reservedTokenUpperBound,
    reportedUsageTokens,
  });
}
