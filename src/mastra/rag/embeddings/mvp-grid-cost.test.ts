import assert from 'node:assert/strict';
import test from 'node:test';
import { countH9Cl100kTokens } from '../processing/cl100k-counter.ts';
import { estimateMvpGridCosts } from './mvp-grid-cost.ts';

function input(content: string) {
  return { content, tokenCount: countH9Cl100kTokens(content) };
}

test('MVP quotes rendered tokens and three retries per document using the largest batch', () => {
  const result = estimateMvpGridCosts([
    Array.from({ length: 129 }, () => input('Hello')),
    [input('Hello'), input('there friend')],
  ]);
  assert.equal(result.priceSnapshotDate, '2026-11-19');
  assert.equal(result.priceMicroUsdPerMillionInputTokens, '20000');
  assert.equal(result.spaceId, 'chunks_te3s_1536_v1');
  assert.equal(result.dimension, 1536);
  assert.equal(result.documents[0].measured.retryInclusiveReservation, 513);
  assert.equal(result.documents[1].measured.retryInclusiveReservation, 12);
  assert.deepEqual(result.corpus.measured, {
    totalTokens: 132,
    batchCount: 3,
    largestBatchTokens: 128,
    largestBatchInputs: 128,
    retryInclusiveReservation: 525,
    maxProviderCalls: 9,
    inputsOverHardChunkLimit: 0,
    estimatedIngestionMicroUsd: '3',
    estimatedReservationMicroUsd: '11',
    fitsH11IngestionBudget: true,
    headroom: {
      jobTokens: 149_487,
      dailyTokens: 249_475,
      monthlyTokens: 4_999_475,
      monthlyEvaluationTokens: 100_000,
      appMonthlyMicroUsd: '999989',
    },
  });
  assert.equal(result.corpus.runtimeByteEnvelope.totalTokens, 1_710);
  assert.equal(result.corpus.runtimeByteEnvelope.retryInclusiveReservation, 6_801);
  assert.equal(result.corpus.runtimeByteEnvelope.estimatedReservationMicroUsd, '137');
  assert.equal(result.assumptions.paidAdmissionApproved, false);
  assert.doesNotMatch(JSON.stringify(result), /Hello|there friend/u);
});

test('MVP exposes the same-day budget boundary and the separate runtime byte ceiling', () => {
  const chunks = Array(150).fill(input(' foo'.repeat(250)));
  const sameDay = estimateMvpGridCosts([chunks, chunks]);
  assert.equal(sameDay.documents[0].measured.fitsH11IngestionBudget, true);
  assert.equal(sameDay.documents[1].measured.fitsH11IngestionBudget, true);
  assert.equal(sameDay.corpus.measured.fitsH11IngestionBudget, false);
  assert.equal(sameDay.corpus.measured.headroom.jobTokens, 16_500);
  assert.equal(sameDay.corpus.measured.headroom.dailyTokens, -17_000);

  const largeInput = estimateMvpGridCosts([[input(' Hello'.repeat(200))]]);
  assert.equal(largeInput.corpus.measured.inputsOverHardChunkLimit, 0);
  assert.equal(largeInput.corpus.runtimeByteEnvelope.inputsOverHardChunkLimit, 1);
  assert.equal(largeInput.corpus.runtimeByteEnvelope.fitsH11IngestionBudget, true);
});
