import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { sha256 } from '../src/mastra/rag/contracts/ids.ts';
import {
  assertEmbeddingDispatchPermitted, assertEmbeddingReservationComplete, beginEmbeddingAttempt,
  closeEmbeddingReservation, finishEmbeddingAttempt, inspectEmbeddingFailure, inspectEmbeddingResponse,
  reconcileEmbeddingAttempt, recordLateEmbeddingOutcome, reserveEmbeddingPlan,
} from '../src/mastra/rag/embeddings/durable-budget.ts';
import { RagEmbeddingError } from '../src/mastra/rag/embeddings/errors.ts';
import {
  prepareMeasuredEmbeddingPlan, type MeasuredEmbeddingBatch,
} from '../src/mastra/rag/embeddings/measured-preflight.ts';
import type { EmbeddingProvider } from '../src/mastra/rag/embeddings/provider.ts';
import { withTransaction } from '../src/mastra/rag/ingestion/database.ts';
import { openE2LocalPool } from './e2-local.ts';

const spaceId = 'chunks_te3s_1536_v1';
const provider: EmbeddingProvider = {
  spaceId,
  dimension: 1536,
  maxInputsPerCall: 128,
  maxInputTokens: 8191,
  async embed() { throw new Error('EMBED_TEST_NETWORK_FORBIDDEN'); },
};
const createPlan = (tokens: number, count = 1, maxInputsPerCall = 128) => prepareMeasuredEmbeddingPlan(
  { ...provider, maxInputsPerCall },
  Array.from({ length: count }, (_, index) => ({
    chunkId: sha256(`e2-budget-${index}`),
    text: ' token'.repeat(tokens),
  })),
);

const pool = await openE2LocalPool();
const otherPool = await openE2LocalPool();
const ownerPool = await openE2LocalPool('owner');
const run = <T>(work: Parameters<typeof withTransaction<T>>[1]) => withTransaction(pool, work);
const newJob = async () => {
  const id = await run(async tx => {
    const { rows } = await tx.query<{ job_id: string }>(
      `INSERT INTO rag.ingestion_job (idempotency_key, kind, space_id, stage)
       VALUES ($1, 'reindex', $2, 'e2-budget-test') RETURNING job_id`,
      [sha256(randomUUID()), spaceId],
    );
    return rows[0].job_id;
  });
  return id;
};
const begin = (jobId: string, index: number, batch: MeasuredEmbeddingBatch) =>
  run(tx => beginEmbeddingAttempt(tx, jobId, index, batch));

type Totals = { amount: string; reserved: number; measured: number; closed: boolean; attempts: number };
async function totals(jobId: string): Promise<Totals> {
  return run(async tx => {
    const { rows: [row] } = await tx.query<Totals>(
      `SELECT held_tokens::text AS amount, reserved_tokens AS reserved, measured_tokens AS measured,
         closed_at IS NOT NULL AS closed,
         (SELECT count(*)::integer FROM rag.embedding_attempt WHERE job_id = $1) AS attempts
       FROM rag.embedding_reservation WHERE job_id = $1`, [jobId],
    );
    return row;
  });
}
const close = (jobId: string) => run(tx => closeEmbeddingReservation(tx, jobId));
const budgetError = { code: 'EMBED_BUDGET_EXCEEDED' };
const reconcileError = { code: 'EMBED_RECONCILIATION_REQUIRED' };

try {
  const big = createPlan(500, 70);
  assert.equal(big.totalTokens, 35_000);
  assert.equal(big.worstCaseTokenReservation, 140_000);
  const contenderA = await newJob();
  const contenderB = await newJob();
  const allocations = await Promise.allSettled([
    run(tx => reserveEmbeddingPlan(tx, contenderA, big)),
    withTransaction(otherPool, tx => reserveEmbeddingPlan(tx, contenderB, big)),
  ]);
  assert.equal(allocations.filter(result => result.status === 'fulfilled').length, 1);
  const failed = allocations.find(result => result.status === 'rejected');
  assert.equal(failed?.reason?.code, budgetError.code);
  const winner = allocations[0].status === 'fulfilled' ? contenderA : contenderB;
  await run(tx => reserveEmbeddingPlan(tx, winner, big));
  assert.deepEqual(await totals(winner), { amount: '140000', reserved: 140000, measured: 35000, closed: false, attempts: 0 });
  await close(winner);
  await close(winner);
  assert.equal((await totals(winner)).amount, '0');
  await assert.rejects(() => begin(winner, 0, big.batches[0]), { code: 'EMBED_RESERVATION_CLOSED' });

  const retryJob = await newJob();
  const plan = createPlan(2, 2, 1);
  await run(tx => reserveEmbeddingPlan(tx, retryJob, plan));
  assert.deepEqual(await totals(retryJob), { amount: '10', reserved: 10, measured: 4, closed: false, attempts: 0 });
  const confirmedContact = new RagEmbeddingError('EMBED_PROVIDER_TRANSIENT', { retryable: true, retryAfterMs: 500 });
  for (let index = 0; index < 4; index++) {
    const attempt = await withTransaction(otherPool, tx => beginEmbeddingAttempt(tx, retryJob, 0, plan.batches[0]));
    assert.equal(attempt.state, 'started');
    assert.equal(attempt.retriesUsed, index);
    if (index === 3) {
      await run(tx => finishEmbeddingAttempt(tx, attempt.attemptId, { state: 'succeeded', reportedTokens: 1 }));
    } else {
      const outcome = inspectEmbeddingFailure(confirmedContact, attempt, () => 0);
      assert.equal(outcome.state, 'retryable');
      await run(tx => finishEmbeddingAttempt(tx, attempt.attemptId, outcome));
      const viaFreshConnection = await withTransaction(otherPool,
        tx => beginEmbeddingAttempt(tx, retryJob, 0, plan.batches[0]));
      assert.equal(viaFreshConnection.state, 'wait');
      await sleep(viaFreshConnection.delayMs + 20);
    }
  }
  assert.equal((await begin(retryJob, 0, plan.batches[0])).state, 'complete');
  const second = await begin(retryJob, 1, plan.batches[1]);
  assert.equal(second.state, 'started');
  assert.equal(second.retriesUsed, 3);
  await run(tx => finishEmbeddingAttempt(tx, second.attemptId, { state: 'retryable', delayMs: 0, errorCode: 'EMBED_PROVIDER_TRANSIENT' }));
  await assert.rejects(() => begin(retryJob, 1, plan.batches[1]), { code: 'EMBED_RETRY_EXHAUSTED' });
  await assert.rejects(() => run(tx => assertEmbeddingReservationComplete(tx, retryJob)), { code: 'EMBED_RESERVATION_MISMATCH' });
  await close(retryJob);
  assert.deepEqual(await totals(retryJob), { amount: '9', reserved: 10, measured: 4, closed: true, attempts: 5 });

  const crashJob = await newJob();
  const one = createPlan(4);
  await run(tx => reserveEmbeddingPlan(tx, crashJob, one));
  assert.equal((await begin(crashJob, 0, one.batches[0])).state, 'started');
  await assert.rejects(() => withTransaction(otherPool,
    tx => beginEmbeddingAttempt(tx, crashJob, 0, one.batches[0])), reconcileError);
  await close(crashJob);
  assert.deepEqual(await totals(crashJob), { amount: '4', reserved: 16, measured: 4, closed: true, attempts: 1 });

  const smallA = await newJob();
  const smallB = await newJob();
  const evaluation = createPlan(500, 30);
  assert.equal(evaluation.worstCaseTokenReservation, 60_000);
  await run(tx => reserveEmbeddingPlan(tx, smallA, evaluation, 'evaluation'));
  await assert.rejects(() => run(tx => reserveEmbeddingPlan(tx, smallB, evaluation, 'evaluation')), budgetError);
  await close(smallA);
  await run(tx => reserveEmbeddingPlan(tx, smallB, evaluation, 'evaluation'));
  await close(smallB);

  const dayBoundary = await newJob();
  await run(async tx => {
    await tx.query(
      `INSERT INTO rag.embedding_reservation
         (job_id, purpose, model_id, space_id, utc_day, measured_tokens,
          reserved_tokens, estimated_micro_usd, batch_plan)
       VALUES ($1, 'ingestion', 'openai/text-embedding-3-small', $2,
               timezone('UTC', clock_timestamp())::date - 1, 4, 16, 1, $3::jsonb)`,
      [dayBoundary, spaceId, JSON.stringify(one.batches.map(batch =>
        ({ chunk_ids: batch.chunks.map(chunk => chunk.chunkId), tokens: batch.tokens, hash: batch.hash })))],
    );
  });
  await assert.rejects(() => begin(dayBoundary, 0, one.batches[0]), { code: 'EMBED_RESERVATION_EXPIRED' });
  await close(dayBoundary);

  const monthBlocked = await newJob();
  await assert.rejects(() => run(async tx => {
    await tx.query(`WITH seeded_jobs AS (
      INSERT INTO rag.ingestion_job (idempotency_key, kind, space_id, stage)
      SELECT md5(gen_random_uuid()::text) || md5(gen_random_uuid()::text),
        'reindex', $1, 'e2-budget-fixture' FROM generate_series(1, 33)
      RETURNING job_id
    ), current_day AS (SELECT timezone('UTC', clock_timestamp())::date AS today)
    INSERT INTO rag.embedding_reservation
      (job_id, purpose, model_id, space_id, utc_day, measured_tokens,
       reserved_tokens, estimated_micro_usd, batch_plan)
    SELECT job_id, 'ingestion', 'openai/text-embedding-3-small', $1,
      CASE WHEN extract(day FROM today) = 1 THEN today + 1 ELSE today - 1 END,
      35000, 150000, 3000, '[{}]'::jsonb
    FROM seeded_jobs CROSS JOIN current_day`, [spaceId]);
    await reserveEmbeddingPlan(tx, monthBlocked, evaluation);
  }), budgetError);

  const overageJob = await newJob();
  const awaitingDispatch = await newJob();
  const blocked = await newJob();
  await run(tx => reserveEmbeddingPlan(tx, overageJob, one));
  await run(tx => reserveEmbeddingPlan(tx, awaitingDispatch, one));
  const attempt = await begin(overageJob, 0, one.batches[0]);
  const provisional = await begin(awaitingDispatch, 0, one.batches[0]);
  assert.equal(attempt.state, 'started');
  assert.equal(provisional.state, 'started');
  await run(tx => assertEmbeddingDispatchPermitted(tx, provisional.attemptId));

  // Deletion may close the exposure before the response arrives. A late
  // overage must affect future admissions without regaining write authority.
  await close(overageJob);
  await run(tx => tx.query("UPDATE rag.ingestion_job SET status='cancelled' WHERE job_id=$1", [overageJob]));
  const outcome = inspectEmbeddingResponse({ usage: { tokens: 30 } }, one.batches[0]);
  assert.equal(outcome.state, 'overage');
  await run(tx => recordLateEmbeddingOutcome(tx, attempt.attemptId, outcome));
  await run(tx => recordLateEmbeddingOutcome(tx, attempt.attemptId, outcome));
  await assert.rejects(() => run(tx => assertEmbeddingReservationComplete(tx, overageJob)), reconcileError);
  assert.deepEqual(await totals(overageJob), { amount: '30', reserved: 16, measured: 4, closed: true, attempts: 1 });
  await assert.rejects(() => run(tx => assertEmbeddingDispatchPermitted(tx, provisional.attemptId)), reconcileError);
  await assert.rejects(() => run(tx => reserveEmbeddingPlan(tx, blocked, one)), reconcileError);
  const statuses = await run(async tx => {
    const { rows } = await tx.query(
      "SELECT state, reported_tokens FROM rag.embedding_attempt WHERE state = 'overage' AND job_id = $1", [overageJob],
    );
    return rows;
  });
  assert.deepEqual(statuses, [{ state: 'overage', reported_tokens: '30' }]);
  await assert.rejects(() => run(tx => reconcileEmbeddingAttempt(tx, attempt.attemptId, 25)), { code: '42501' });
  for (let replay = 0; replay < 2; replay++) {
    await withTransaction(ownerPool, tx => reconcileEmbeddingAttempt(tx, attempt.attemptId, 25));
  }
  assert.equal((await totals(overageJob)).amount, '25');
  await run(tx => reserveEmbeddingPlan(tx, blocked, one));
  await close(blocked);
  await close(awaitingDispatch);
  console.log(JSON.stringify({
    concurrentAdmission: { admitted: 1, denied: 1, reservedTokens: 140_000 },
    retryBudget: { retries: 3, attempts: 5, heldTokens: 9 },
    crashExposureTokens: 4,
    blockedAtUtcDayChange: true,
    evaluationSubBudgetEnforced: true,
    monthlyBudgetEnforced: true,
    lateOverageTokens: 30,
    ownerReconciledTokens: 25,
    independentPoolReplayBlocked: true,
  }));
} finally {
  await Promise.all([pool.end(), otherPool.end(), ownerPool.end()]);
}
