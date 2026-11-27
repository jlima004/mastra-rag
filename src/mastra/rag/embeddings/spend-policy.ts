import { RAG_LIMITS } from '../contracts/types.ts';
import { RagEmbeddingError } from './errors.ts';
import type { EmbeddingJobPlan } from './job.ts';

export const H11_MODEL_ID = 'openai/text-embedding-3-small' as const;
export const H11_PRICE_MICRO_USD_PER_MILLION_INPUT_TOKENS = 20_000n;
const ONE_MILLION = 1_000_000n;
export const MICRO_USD_PER_CENT = 10_000n;
const MAX_MONTHLY_TOKENS = 2_000_000_000;

/**
 * Operator-proposed numeric limits. This is deliberately NOT a proof that a
 * provider-side hard limit is configured, nor an authorization to make paid
 * requests. A future E2 adapter must use a durable, atomic reservations ledger.
 */
export type H11OfflinePolicy = Readonly<{
  modelId: typeof H11_MODEL_ID;
  plannedProviderHardLimitUsdCents: number;
  applicationMonthlyBudgetUsdCents: number;
  maxMonthlyReservedTokens: number;
  maxDailyReservedTokens: number;
  maxJobReservedTokens: number;
  maxEvaluationMonthlyReservedTokens: number;
}>;

// Owner-ratified numbers from RAG-H11-embedding-spend-control.md.
export const H11_MVP_POLICY: H11OfflinePolicy = Object.freeze({
  modelId: H11_MODEL_ID,
  plannedProviderHardLimitUsdCents: 200,
  applicationMonthlyBudgetUsdCents: 100,
  maxMonthlyReservedTokens: 5_000_000,
  maxDailyReservedTokens: 250_000,
  maxJobReservedTokens: 150_000,
  maxEvaluationMonthlyReservedTokens: 100_000,
});

/**
 * Caller-supplied historical totals are untrusted for live enforcement.
 * Only the future durable E2 ledger may supply authoritative snapshots.
 */
export type H11OfflineSnapshot = Readonly<{
  monthlyReservedTokens: number;
  dailyReservedTokens: number;
  evaluationMonthlyReservedTokens: number;
}>;

export type H11OfflineQuote = Readonly<{
  modelId: typeof H11_MODEL_ID;
  purpose: 'ingestion' | 'evaluation';
  requestedReservedTokens: number;
  estimatedRequestMicroUsd: bigint;
  projectedMonthlyReservedTokens: number;
  projectedDailyReservedTokens: number;
  projectedEvaluationReservedTokens: number;
  estimatedProjectedMonthlyMicroUsd: bigint;
}>;

function nonnegative(n: unknown, max = MAX_MONTHLY_TOKENS): n is number {
  return typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 && n <= max;
}

function positive(n: unknown, max = MAX_MONTHLY_TOKENS): n is number {
  return nonnegative(n, max) && n > 0;
}

function invalid(): never {
  throw new RagEmbeddingError('EMBED_INVALID_INPUT');
}

function exceeded(): never {
  throw new RagEmbeddingError('EMBED_BUDGET_EXCEEDED');
}

/** Exact, upward-rounded micro-USD quote; never use floating-point dollars. */
export function estimateH11EmbeddingCostMicroUsd(tokens: number): bigint {
  if (!nonnegative(tokens)) invalid();
  return (BigInt(tokens) * H11_PRICE_MICRO_USD_PER_MILLION_INPUT_TOKENS
    + ONE_MILLION - 1n) / ONE_MILLION;
}

/**
 * Pure offline quote ONLY. It neither claims monthly billing truth nor reserves
 * anything, and must NOT be used alone to authorize a provider request.
 *
 * Future live E2 integration requires:
 * - a separately approved billing project/provider hard-limit receipt;
 * - H9 tokenizer validation;
 * - serialized durable reservation + finalize/reconciliation on every attempt;
 * - a new independent human permission for paid calls.
 */
export function quoteH11OfflineReservation(
  policy: H11OfflinePolicy,
  snapshot: H11OfflineSnapshot,
  plan: Pick<EmbeddingJobPlan, 'spaceId' | 'worstCaseTokenReservation'>,
  purpose: 'ingestion' | 'evaluation',
): H11OfflineQuote {
  if (!policy || !snapshot || !plan ||
      policy.modelId !== H11_MODEL_ID ||
      !positive(policy.plannedProviderHardLimitUsdCents, 100_000) ||
      !positive(policy.applicationMonthlyBudgetUsdCents, 100_000) ||
      policy.applicationMonthlyBudgetUsdCents > policy.plannedProviderHardLimitUsdCents ||
      !positive(policy.maxMonthlyReservedTokens) ||
      !positive(policy.maxDailyReservedTokens) ||
      !positive(policy.maxJobReservedTokens, RAG_LIMITS.MAX_TOKENS_PER_JOB) ||
      !positive(policy.maxEvaluationMonthlyReservedTokens) ||
      policy.maxDailyReservedTokens > policy.maxMonthlyReservedTokens ||
      policy.maxJobReservedTokens > policy.maxDailyReservedTokens ||
      policy.maxEvaluationMonthlyReservedTokens > policy.maxMonthlyReservedTokens ||
      !nonnegative(snapshot.monthlyReservedTokens) ||
      !nonnegative(snapshot.dailyReservedTokens) ||
      !nonnegative(snapshot.evaluationMonthlyReservedTokens) ||
      snapshot.dailyReservedTokens > snapshot.monthlyReservedTokens ||
      snapshot.evaluationMonthlyReservedTokens > snapshot.monthlyReservedTokens ||
      plan.spaceId !== 'chunks_te3s_1536_v1' ||
      !nonnegative(plan.worstCaseTokenReservation, RAG_LIMITS.MAX_TOKENS_PER_JOB) ||
      (purpose !== 'ingestion' && purpose !== 'evaluation')) {
    invalid();
  }

  const requested = plan.worstCaseTokenReservation;
  const projectedMonthly = snapshot.monthlyReservedTokens + requested;
  const projectedDaily = snapshot.dailyReservedTokens + requested;
  const projectedEvaluation = snapshot.evaluationMonthlyReservedTokens +
    (purpose === 'evaluation' ? requested : 0);

  if (requested > policy.maxJobReservedTokens ||
      projectedMonthly > policy.maxMonthlyReservedTokens ||
      projectedDaily > policy.maxDailyReservedTokens ||
      projectedEvaluation > policy.maxEvaluationMonthlyReservedTokens) {
    exceeded();
  }

  const projectedCost = estimateH11EmbeddingCostMicroUsd(projectedMonthly);
  if (projectedCost > BigInt(policy.applicationMonthlyBudgetUsdCents) * MICRO_USD_PER_CENT) {
    exceeded();
  }

  return Object.freeze({
    modelId: H11_MODEL_ID,
    purpose,
    requestedReservedTokens: requested,
    estimatedRequestMicroUsd: estimateH11EmbeddingCostMicroUsd(requested),
    projectedMonthlyReservedTokens: projectedMonthly,
    projectedDailyReservedTokens: projectedDaily,
    projectedEvaluationReservedTokens: projectedEvaluation,
    estimatedProjectedMonthlyMicroUsd: projectedCost,
  });
}
