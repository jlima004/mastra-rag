import assert from 'node:assert/strict';
import test from 'node:test';
import { RagEmbeddingError } from './errors.ts';
import {
  estimateH11EmbeddingCostMicroUsd,
  H11_MODEL_ID,
  quoteH11OfflineReservation,
  type H11OfflinePolicy,
  type H11OfflineSnapshot,
} from './spend-policy.ts';

const policy: H11OfflinePolicy = Object.freeze({
  modelId: H11_MODEL_ID,
  plannedProviderHardLimitUsdCents: 200,
  applicationMonthlyBudgetUsdCents: 100,
  maxMonthlyReservedTokens: 5_000_000,
  maxDailyReservedTokens: 250_000,
  maxJobReservedTokens: 150_000,
  maxEvaluationMonthlyReservedTokens: 100_000,
});
const zero: H11OfflineSnapshot = Object.freeze({
  monthlyReservedTokens: 0,
  dailyReservedTokens: 0,
  evaluationMonthlyReservedTokens: 0,
});
const plan = (tokens: number, spaceId = 'chunks_te3s_1536_v1') =>
  ({ spaceId, worstCaseTokenReservation: tokens });
const budgetError = (error: unknown) =>
  error instanceof RagEmbeddingError && error.code === 'EMBED_BUDGET_EXCEEDED';
const inputError = (error: unknown) =>
  error instanceof RagEmbeddingError && error.code === 'EMBED_INVALID_INPUT';

test('H11 current price: micro-USD arithmetic is exact and rounded upward', () => {
  assert.equal(estimateH11EmbeddingCostMicroUsd(0), 0n);
  assert.equal(estimateH11EmbeddingCostMicroUsd(1), 1n);
  assert.equal(estimateH11EmbeddingCostMicroUsd(50), 1n);
  assert.equal(estimateH11EmbeddingCostMicroUsd(51), 2n);
  assert.equal(estimateH11EmbeddingCostMicroUsd(1_000_000), 20_000n);
  for (const invalid of [-1, NaN, Infinity, 1.2, '20']) {
    assert.throws(() => estimateH11EmbeddingCostMicroUsd(invalid as number), inputError);
  }
});

test('H11 quote uses worst-case reservation, not successful-call usage', () => {
  const q = quoteH11OfflineReservation(policy, zero, plan(145_000), 'ingestion');
  assert.equal(q.requestedReservedTokens, 145_000);
  assert.equal(q.projectedMonthlyReservedTokens, 145_000);
  assert.equal(q.projectedDailyReservedTokens, 145_000);
  assert.equal(q.projectedEvaluationReservedTokens, 0);
  assert.equal(q.estimatedRequestMicroUsd, 2_900n);
  assert.equal(Object.isFrozen(q), true);
});

test('H11 rejects a job or a daily total at the inclusive threshold', () => {
  assert.doesNotThrow(() => quoteH11OfflineReservation(policy, zero, plan(150_000), 'ingestion'));
  assert.throws(() => quoteH11OfflineReservation(policy, zero, plan(150_001), 'ingestion'), budgetError);
  assert.doesNotThrow(() => quoteH11OfflineReservation(
    policy, { monthlyReservedTokens: 150_000, dailyReservedTokens: 150_000,
      evaluationMonthlyReservedTokens: 0 }, plan(100_000), 'ingestion'));
  assert.throws(() => quoteH11OfflineReservation(
    policy, { monthlyReservedTokens: 150_001, dailyReservedTokens: 150_001,
      evaluationMonthlyReservedTokens: 0 }, plan(100_000), 'ingestion'), budgetError);
});

test('H11 evaluation bucket remains isolated from ingestion bucket', () => {
  const used = { monthlyReservedTokens: 98_000, dailyReservedTokens: 98_000,
    evaluationMonthlyReservedTokens: 98_000 };
  assert.throws(() => quoteH11OfflineReservation(policy, used, plan(2_001), 'evaluation'), budgetError);
  const ingest = quoteH11OfflineReservation(policy, used, plan(2_001), 'ingestion');
  assert.equal(ingest.projectedEvaluationReservedTokens, 98_000);
  const evaluation = quoteH11OfflineReservation(policy, used, plan(2_000), 'evaluation');
  assert.equal(evaluation.projectedEvaluationReservedTokens, 100_000);
});

test('H11 monthly token ceiling and application money ceiling are independent', () => {
  const monthly = { monthlyReservedTokens: 4_900_000, dailyReservedTokens: 0,
    evaluationMonthlyReservedTokens: 0 };
  assert.doesNotThrow(() => quoteH11OfflineReservation(policy, monthly, plan(100_000), 'ingestion'));
  assert.throws(() => quoteH11OfflineReservation(policy, monthly, plan(100_001), 'ingestion'),
    budgetError);
  const money = { ...policy, applicationMonthlyBudgetUsdCents: 1 };
  assert.doesNotThrow(() => quoteH11OfflineReservation(money,
    { monthlyReservedTokens: 400_000, dailyReservedTokens: 0, evaluationMonthlyReservedTokens: 0 },
    plan(100_000), 'ingestion'));
  const smallJobMoney = { ...money, maxJobReservedTokens: 150_000 };
  const already = { monthlyReservedTokens: 450_000, dailyReservedTokens: 0,
    evaluationMonthlyReservedTokens: 0 };
  assert.throws(() => quoteH11OfflineReservation(smallJobMoney, already, plan(100_000), 'ingestion'),
    budgetError);
});

test('H11 invalid, missing or incompatible policy and snapshots fail closed', () => {
  const invalidPolicies: H11OfflinePolicy[] = [
    { ...policy, plannedProviderHardLimitUsdCents: 0 },
    { ...policy, applicationMonthlyBudgetUsdCents: 201 },
    { ...policy, maxJobReservedTokens: 2_000_001 },
    { ...policy, maxDailyReservedTokens: 149_999 },
    { ...policy, maxEvaluationMonthlyReservedTokens: 5_000_001 },
  ];
  for (const candidate of invalidPolicies) {
    assert.throws(() => quoteH11OfflineReservation(candidate, zero, plan(100), 'ingestion'),
      inputError);
  }
  const invalidSnapshots: H11OfflineSnapshot[] = [
    { ...zero, monthlyReservedTokens: -1 },
    { ...zero, dailyReservedTokens: 50 },
    { ...zero, evaluationMonthlyReservedTokens: 1 },
  ];
  for (const candidate of invalidSnapshots) {
    assert.throws(() => quoteH11OfflineReservation(policy, candidate, plan(100), 'ingestion'),
      inputError);
  }
  assert.throws(() => quoteH11OfflineReservation(policy, zero, plan(1,'wrong-space'), 'ingestion'),
    inputError);
  assert.throws(() => quoteH11OfflineReservation(policy, zero, plan(-1), 'ingestion'), inputError);
  assert.throws(() => quoteH11OfflineReservation(policy, zero, plan(50), 'unknown' as 'ingestion'),
    inputError);
});

test('H11 zero-work quote consumes no planned tokens; pure budget never calls provider', () => {
  const q = quoteH11OfflineReservation(policy, zero, plan(0), 'evaluation');
  assert.equal(q.estimatedRequestMicroUsd, 0n);
  assert.equal(q.projectedEvaluationReservedTokens, 0);
});
