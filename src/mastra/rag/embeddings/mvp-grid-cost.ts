import { RAG_LIMITS } from '../contracts/types.ts';
import type { H9RenderedTokenChunk } from '../processing/token-grid.ts';
import { RagEmbeddingError } from './errors.ts';
import {
  conservativeInputTokenUpperBound, EMBEDDING_JOB_MAX_BATCH_SIZE, planEmbeddingBatches,
} from './job.ts';
import { requireEmbeddingSpace } from './space.ts';
import {
  estimateH11EmbeddingCostMicroUsd, H11_MODEL_ID, H11_PRICE_MICRO_USD_PER_MILLION_INPUT_TOKENS,
  MICRO_USD_PER_CENT, quoteH11OfflineReservation, type H11OfflinePolicy,
} from './spend-policy.ts';

const SPACE = requireEmbeddingSpace('chunks_te3s_1536_v1');
// Numeric decision in RAG-H11-embedding-spend-control.md (2026-11-19).
// This policy is scoped to the offline calibration.
const LIMITS: H11OfflinePolicy = Object.freeze({
  modelId: H11_MODEL_ID,
  plannedProviderHardLimitUsdCents: 200,
  applicationMonthlyBudgetUsdCents: 100,
  maxMonthlyReservedTokens: 5_000_000,
  maxDailyReservedTokens: 250_000,
  maxJobReservedTokens: 150_000,
  maxEvaluationMonthlyReservedTokens: 100_000,
});

type Input = Pick<H9RenderedTokenChunk, 'content' | 'tokenCount'>;

function planJob(inputTokens: readonly number[]) {
  const plan = planEmbeddingBatches(inputTokens, count => count, EMBEDDING_JOB_MAX_BATCH_SIZE);
  return {
    totalTokens: plan.totalTokens,
    batchCount: plan.batches.length,
    largestBatchTokens: plan.largestBatchTokens,
    largestBatchInputs: Math.min(inputTokens.length, EMBEDDING_JOB_MAX_BATCH_SIZE),
    retryInclusiveReservation: plan.worstCaseTokenReservation,
    maxProviderCalls: plan.maxProviderCalls,
    inputsOverHardChunkLimit: inputTokens.filter(count => count > RAG_LIMITS.HARD_MAX_CHUNK_TOKENS).length,
  };
}

type Job = ReturnType<typeof planJob>;

function fitsH11(job: Job, earlierReservedTokens: number): boolean {
  if (job.retryInclusiveReservation > RAG_LIMITS.MAX_TOKENS_PER_JOB ||
      earlierReservedTokens > LIMITS.maxDailyReservedTokens) return false;
  try {
    quoteH11OfflineReservation(LIMITS, {
      monthlyReservedTokens: earlierReservedTokens,
      dailyReservedTokens: earlierReservedTokens,
      evaluationMonthlyReservedTokens: 0,
    }, {
      spaceId: SPACE.spaceId,
      worstCaseTokenReservation: job.retryInclusiveReservation,
    }, 'ingestion');
    return true;
  } catch (error) {
    if (error instanceof RagEmbeddingError && error.code === 'EMBED_BUDGET_EXCEEDED') return false;
    throw error;
  }
}

function summarizeJobs(jobs: readonly Job[]) {
  let totalTokens = 0;
  let batchCount = 0;
  let largestBatchTokens = 0;
  let largestBatchInputs = 0;
  let retryInclusiveReservation = 0;
  let largestJobReservation = 0;
  let maxProviderCalls = 0;
  let inputsOverHardChunkLimit = 0;
  let fitsH11IngestionBudget = true;
  for (const job of jobs) {
    fitsH11IngestionBudget &&= fitsH11(job, retryInclusiveReservation);
    totalTokens += job.totalTokens;
    batchCount += job.batchCount;
    largestBatchTokens = Math.max(largestBatchTokens, job.largestBatchTokens);
    largestBatchInputs = Math.max(largestBatchInputs, job.largestBatchInputs);
    retryInclusiveReservation += job.retryInclusiveReservation;
    largestJobReservation = Math.max(largestJobReservation, job.retryInclusiveReservation);
    maxProviderCalls += job.maxProviderCalls;
    inputsOverHardChunkLimit += job.inputsOverHardChunkLimit;
  }
  const reservedCost = estimateH11EmbeddingCostMicroUsd(retryInclusiveReservation);
  return {
    totalTokens, batchCount, largestBatchTokens, largestBatchInputs,
    retryInclusiveReservation, maxProviderCalls, inputsOverHardChunkLimit,
    estimatedIngestionMicroUsd: String(estimateH11EmbeddingCostMicroUsd(totalTokens)),
    estimatedReservationMicroUsd: String(reservedCost),
    fitsH11IngestionBudget,
    headroom: {
      jobTokens: LIMITS.maxJobReservedTokens - largestJobReservation,
      dailyTokens: LIMITS.maxDailyReservedTokens - retryInclusiveReservation,
      monthlyTokens: LIMITS.maxMonthlyReservedTokens - retryInclusiveReservation,
      monthlyEvaluationTokens: LIMITS.maxEvaluationMonthlyReservedTokens,
      appMonthlyMicroUsd: String(BigInt(LIMITS.applicationMonthlyBudgetUsdCents) * MICRO_USD_PER_CENT - reservedCost),
    },
  };
}

/** One cold ingestion job per document on the same UTC day, with zero prior reservations.
 * The measured basis projects the approved tokenizer counts using H11 arithmetic.
 * The byte envelope separately models the current runtime's conservative preflight.
 */
export function estimateMvpGridCosts(documents: readonly (readonly Input[])[]) {
  const jobs = documents.map(chunks => {
    const inputTokens = chunks.map(chunk => {
      if (!Number.isSafeInteger(chunk.tokenCount) || chunk.tokenCount < 1) {
        throw new RagEmbeddingError('EMBED_INVALID_INPUT');
      }
      return chunk.tokenCount;
    });
    return {
      measured: planJob(inputTokens),
      runtimeByteEnvelope: planJob(chunks.map(chunk => conservativeInputTokenUpperBound(chunk.content))),
    };
  });
  return {
    modelId: H11_MODEL_ID,
    spaceId: SPACE.spaceId,
    dimension: SPACE.dimension,
    priceSnapshotDate: '2026-11-19',
    priceMicroUsdPerMillionInputTokens: String(H11_PRICE_MICRO_USD_PER_MILLION_INPUT_TOKENS),
    limits: LIMITS,
    assumptions: {
      jobScope: 'one-cold-ingestion-job-per-document',
      usage: 'same-utc-day-zero-prior-reservations',
      batchSize: EMBEDDING_JOB_MAX_BATCH_SIZE,
      maxRetriesPerJob: RAG_LIMITS.MAX_JOB_ATTEMPTS - 1,
      hardChunkLimit: RAG_LIMITS.HARD_MAX_CHUNK_TOKENS,
      measuredBasis: 'rendered-cl100k_base-tokens',
      runtimeByteEnvelopeBasis: 'utf8-bytes-plus-eight-per-input',
      durableEnforcementVerified: false,
      paidAdmissionApproved: false,
    },
    documents: jobs.map(job => ({
      measured: summarizeJobs([job.measured]),
      runtimeByteEnvelope: summarizeJobs([job.runtimeByteEnvelope]),
    })),
    corpus: {
      measured: summarizeJobs(jobs.map(job => job.measured)),
      runtimeByteEnvelope: summarizeJobs(jobs.map(job => job.runtimeByteEnvelope)),
    },
  };
}
