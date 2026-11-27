import { canonicalJson } from '../contracts/ids.ts';
import { RAG_LIMITS } from '../contracts/types.ts';
import { lockDocument, type Transaction } from '../ingestion/database.ts';
import { EMBEDDING_ERROR_CODES, RagEmbeddingError, type EmbeddingErrorCode } from './errors.ts';
import { embeddingBackoffMs } from './job.ts';
import type { MeasuredEmbeddingBatch, MeasuredEmbeddingPlan } from './measured-preflight.ts';
import { requireEmbeddingUsage, validateEmbeddingVectors } from './provider.ts';
import { requireEmbeddingSpace } from './space.ts';
import { H11_MODEL_ID, H11_MVP_POLICY, quoteH11OfflineReservation } from './spend-policy.ts';

const BUDGET_SCOPE = 'h11-rag-mastra';
const MAX_RETRIES = RAG_LIMITS.MAX_JOB_ATTEMPTS - 1;
const SPACE = requireEmbeddingSpace('chunks_te3s_1536_v1');
type BudgetPurpose = 'ingestion' | 'evaluation';

type StoredBatch = {
  chunk_ids: string[];
  tokens: number;
  hash: string;
};
type Reservation = {
  batch_plan: StoredBatch[];
  batch_chunk_ids: string[][];
  purpose: BudgetPurpose | 'query';
  space_id: string;
  reserved_tokens: number;
  measured_tokens: number;
  utc_day: string;
  closed_at: Date | null;
};

type AttemptState = 'started' | 'retryable' | 'unknown' | 'succeeded' | 'invalid' | 'overage';
type AttemptRow = {
  attempt_id: string;
  job_id: string;
  batch_index: number;
  attempt_number: number;
  reserved_tokens: number;
  input_hash: string;
  state: AttemptState;
  wait_ms: number | null;
};

type StartedAttempt = {
  state: 'started';
  attemptId: string;
  retriesUsed: number;
  utcDay: string;
  reservedTokens: number;
  callLimitReached: boolean;
};
type BatchAttempt = StartedAttempt | { state: 'wait'; delayMs: number } | { state: 'complete' };
type MeasuredOutcome = { state: 'succeeded'; reportedTokens: number };
type OverageOutcome = { state: 'overage'; reportedTokens: number };
type InvalidOutcome = { state: 'invalid'; reportedTokens: number; errorCode: EmbeddingErrorCode };
type UnknownOutcome = { state: 'unknown'; errorCode: EmbeddingErrorCode };
type RetryableOutcome = { state: 'retryable'; delayMs: number; errorCode: EmbeddingErrorCode };
type StoredOutcome = MeasuredOutcome | OverageOutcome | InvalidOutcome | UnknownOutcome | RetryableOutcome;

export type EmbeddingAttemptOutcome =
  | (MeasuredOutcome & { vectors: number[][] })
  | OverageOutcome
  | InvalidOutcome
  | UnknownOutcome;

/** The caller must hold the document lock and current claim fence first.
 * The budget lock covers all purposes, documents, workers, and UTC periods.
 */
async function lockBudget(tx: Transaction): Promise<void> {
  await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('rag:embedding-budget:' || $1, 0))", [BUDGET_SCOPE]);
}

function batchIdentity(batch: MeasuredEmbeddingBatch): StoredBatch {
  return { chunk_ids: batch.chunks.map(chunk => chunk.chunkId), tokens: batch.tokens, hash: batch.hash };
}

export async function readEmbeddingReservation(tx: Transaction, jobId: string): Promise<Reservation | null> {
  const { rows } = await tx.query<Omit<Reservation, 'batch_chunk_ids'>>(
    `SELECT batch_plan, purpose, space_id, reserved_tokens, measured_tokens, utc_day::text, closed_at
       FROM rag.embedding_reservation WHERE job_id = $1`,
    [jobId],
  );
  const row = rows[0];
  return row ? { ...row, batch_chunk_ids: row.batch_plan.map(batch => batch.chunk_ids) } : null;
}

async function requireNoUnreconciledOverage(tx: Transaction): Promise<void> {
  const { rowCount } = await tx.query(
    "SELECT 1 FROM rag.embedding_attempt WHERE state = 'overage' AND reconciled_at IS NULL LIMIT 1",
  );
  if (rowCount) throw new RagEmbeddingError('EMBED_RECONCILIATION_REQUIRED');
}

/** Snapshot for diagnostics. Only reserveEmbeddingPlan may admit under the budget lock. */
export async function readEmbeddingBudget(tx: Transaction) {
  const { rows: [snapshot] } = await tx.query<{
    utc_day: string; daily_tokens: string; monthly_tokens: string; evaluation_tokens: string;
  }>(`WITH period AS (
        SELECT timezone('UTC', clock_timestamp())::date AS today
      )
      SELECT today::text AS utc_day,
        coalesce(sum(held_tokens) FILTER (WHERE utc_day = today), 0)::text AS daily_tokens,
        coalesce(sum(held_tokens), 0)::text AS monthly_tokens,
        coalesce(sum(held_tokens) FILTER (WHERE purpose = 'evaluation'), 0)::text AS evaluation_tokens
      FROM period
      LEFT JOIN rag.embedding_reservation
        ON budget_scope = $1 AND utc_month = date_trunc('month', today::timestamp)::date
      GROUP BY today`, [BUDGET_SCOPE]);
  return snapshot;
}

/** Idempotent admission. Caller commits this transaction before any call. */
export async function reserveEmbeddingPlan(
  tx: Transaction,
  jobId: string,
  plan: MeasuredEmbeddingPlan,
  purpose: BudgetPurpose = 'ingestion',
): Promise<void> {
  await lockBudget(tx);
  const batchPlan = plan.batches.map(batchIdentity);
  const existing = await readEmbeddingReservation(tx, jobId);
  if (existing) {
    if (existing.space_id !== plan.spaceId || existing.purpose !== purpose ||
        existing.reserved_tokens !== plan.worstCaseTokenReservation || existing.measured_tokens !== plan.totalTokens ||
        canonicalJson(existing.batch_plan) !== canonicalJson(batchPlan)) {
      throw new RagEmbeddingError('EMBED_RESERVATION_MISMATCH');
    }
    return;
  }
  if (!batchPlan.length) return;
  await requireNoUnreconciledOverage(tx);
  const snapshot = await readEmbeddingBudget(tx);
  if (BigInt(snapshot.monthly_tokens) > BigInt(H11_MVP_POLICY.maxMonthlyReservedTokens)) {
    throw new RagEmbeddingError('EMBED_BUDGET_EXCEEDED');
  }
  const quote = quoteH11OfflineReservation(H11_MVP_POLICY, {
    dailyReservedTokens: Number(snapshot.daily_tokens),
    monthlyReservedTokens: Number(snapshot.monthly_tokens),
    evaluationMonthlyReservedTokens: Number(snapshot.evaluation_tokens),
  }, { spaceId: plan.spaceId, worstCaseTokenReservation: plan.worstCaseTokenReservation }, purpose);
  await tx.query(
    `INSERT INTO rag.embedding_reservation
       (job_id, purpose, model_id, space_id, utc_day, measured_tokens, reserved_tokens, estimated_micro_usd, batch_plan)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
    [jobId, purpose, H11_MODEL_ID, plan.spaceId, snapshot.utc_day, plan.totalTokens,
      quote.requestedReservedTokens, quote.estimatedRequestMicroUsd.toString(), JSON.stringify(batchPlan)],
  );
}

async function readAttempts(tx: Transaction, jobId: string): Promise<AttemptRow[]> {
  const { rows } = await tx.query<AttemptRow>(
    `SELECT attempt_id, job_id, batch_index, attempt_number, reserved_tokens, input_hash, state,
       GREATEST(ceil(extract(epoch FROM (retry_at - clock_timestamp())) * 1000), 0)::integer AS wait_ms
     FROM rag.embedding_attempt WHERE job_id = $1 ORDER BY batch_index, attempt_number`,
    [jobId],
  );
  return rows;
}

function assertAttemptIdentities(reservation: Reservation, attempts: AttemptRow[]): void {
  const mismatch = attempts.some(attempt => {
    const batch = reservation.batch_plan[attempt.batch_index];
    return !batch || batch.hash !== attempt.input_hash || batch.tokens !== attempt.reserved_tokens;
  });
  if (mismatch) throw new RagEmbeddingError('EMBED_RESERVATION_MISMATCH');
}

function assertUnambiguous(attempts: AttemptRow[]): void {
  if (attempts.some(attempt => ['started', 'unknown', 'invalid', 'overage'].includes(attempt.state))) {
    throw new RagEmbeddingError('EMBED_RECONCILIATION_REQUIRED');
  }
}

/** A durable start is deliberately treated as ambiguous on process loss, even if the provider
 * was never dispatched. Without provider idempotency a new worker cannot distinguish the two.
 */
export async function beginEmbeddingAttempt(
  tx: Transaction, jobId: string, batchIndex: number, batch: MeasuredEmbeddingBatch,
  maxProviderCalls?: number,
): Promise<BatchAttempt> {
  await lockBudget(tx);
  const reservation = await readEmbeddingReservation(tx, jobId);
  const storedBatch = reservation?.batch_plan[batchIndex];
  if (!reservation || !storedBatch ||
      canonicalJson(storedBatch) !== canonicalJson(batchIdentity(batch))) {
    throw new RagEmbeddingError('EMBED_RESERVATION_MISMATCH');
  }
  const attempts = await readAttempts(tx, jobId);
  assertAttemptIdentities(reservation, attempts);
  assertUnambiguous(attempts);
  const priorBatch = attempts.filter(attempt => attempt.batch_index === batchIndex);
  const last = priorBatch.at(-1);
  if (last?.state === 'succeeded') return { state: 'complete' };
  if (reservation.closed_at) throw new RagEmbeddingError('EMBED_RESERVATION_CLOSED');
  const completed = attempts.filter(attempt => attempt.state === 'succeeded').length;
  if (completed !== batchIndex) throw new RagEmbeddingError('EMBED_RESERVATION_MISMATCH');

  if (maxProviderCalls !== undefined && attempts.length >= maxProviderCalls) {
    throw new RagEmbeddingError('EMBED_CALL_LIMIT_REACHED');
  }

  const retriesUsed = attempts.filter(attempt => attempt.attempt_number > 1).length;
  if (last && retriesUsed >= MAX_RETRIES) throw new RagEmbeddingError('EMBED_RETRY_EXHAUSTED');
  const committed = attempts.reduce((sum, attempt) => sum + attempt.reserved_tokens, 0);
  if (committed + batch.tokens > reservation.reserved_tokens) throw new RagEmbeddingError('EMBED_BUDGET_EXCEEDED');

  await requireNoUnreconciledOverage(tx);
  if (last?.state === 'retryable' && last.wait_ms) return { state: 'wait', delayMs: last.wait_ms };

  const { rows: [newAttempt] } = await tx.query<{ attempt_id: string }>(
    `INSERT INTO rag.embedding_attempt (job_id, batch_index, attempt_number, input_hash, reserved_tokens)
     SELECT $1, $2, $3, $4, $5
     WHERE timezone('UTC', clock_timestamp())::date = $6::date
     RETURNING attempt_id`,
    [jobId, batchIndex, (last?.attempt_number ?? 0) + 1, batch.hash, batch.tokens, reservation.utc_day],
  );
  if (!newAttempt) throw new RagEmbeddingError('EMBED_RESERVATION_EXPIRED');
  await tx.query(
    'UPDATE rag.embedding_reservation SET exposure_tokens = exposure_tokens + $2 WHERE job_id = $1',
    [jobId, batch.tokens],
  );
  return {
    state: 'started', attemptId: newAttempt.attempt_id,
    retriesUsed: retriesUsed + (last ? 1 : 0), utcDay: reservation.utc_day,
    reservedTokens: batch.tokens, callLimitReached: attempts.length + 1 === maxProviderCalls,
  };
}

/** Recheck immediately before dispatcher invocation, after any local await or checkpoint. */
export async function assertEmbeddingDispatchPermitted(tx: Transaction, attemptId: string): Promise<void> {
  await lockBudget(tx);
  const { rows: [reservation] } = await tx.query<{ in_period: boolean; open: boolean }>(
    `SELECT r.closed_at IS NULL AS open,
       r.utc_day = timezone('UTC', clock_timestamp())::date AS in_period
     FROM rag.embedding_attempt a JOIN rag.embedding_reservation r USING (job_id)
     WHERE a.attempt_id = $1 AND a.state = 'started'`, [attemptId],
  );
  if (!reservation?.open) throw new RagEmbeddingError('EMBED_RESERVATION_CLOSED');
  if (!reservation.in_period) throw new RagEmbeddingError('EMBED_RESERVATION_EXPIRED');
  await requireNoUnreconciledOverage(tx);
}

/** Compare measured input with provider-reported usage before discarding any invalid response. */
export function inspectEmbeddingResponse(response: unknown, batch: MeasuredEmbeddingBatch): EmbeddingAttemptOutcome {
  let reportedTokens: number;
  try {
    const raw = response as { usage: unknown; vectors: unknown };
    reportedTokens = requireEmbeddingUsage(raw.usage);
    if (reportedTokens < 1) throw new RagEmbeddingError('EMBED_USAGE_INVALID');
  } catch {
    return { state: 'unknown', errorCode: 'EMBED_USAGE_INVALID' };
  }
  if (reportedTokens > batch.tokens) return { state: 'overage', reportedTokens };
  try {
    const vectors = (response as { vectors: unknown }).vectors;
    const valid = validateEmbeddingVectors(vectors, batch.chunks.length, SPACE.dimension);
    if (valid.some(vector => vector.some(value => !Number.isFinite(Math.fround(value))))) {
      throw new RagEmbeddingError('EMBED_NONFINITE_VECTOR');
    }
    return { state: 'succeeded', reportedTokens, vectors: valid };
  } catch (error) {
    return { state: 'invalid', reportedTokens, errorCode: sanitizedCode(error) };
  }
}

function sanitizedCode(error: unknown): EmbeddingErrorCode {
  return error instanceof RagEmbeddingError && EMBEDDING_ERROR_CODES.includes(error.code)
    ? error.code : 'EMBED_PROVIDER_FAILURE';
}

/** Confirmed retryable upstream errors retain full billable exposure. A timeout or process
 * loss is ambiguous and must block until reconciliation rather than trigger a retry.
 */
export function inspectEmbeddingFailure(
  error: unknown,
  attempt: StartedAttempt,
  random: () => number = Math.random,
): RetryableOutcome | UnknownOutcome | InvalidOutcome | OverageOutcome {
  const errorCode = sanitizedCode(error);
  if (error instanceof RagEmbeddingError && error.reportedTokens !== null) {
    const reportedTokens = error.reportedTokens;
    if (reportedTokens > attempt.reservedTokens) return { state: 'overage', reportedTokens };
    return { state: 'invalid', reportedTokens, errorCode };
  }
  if (!(error instanceof RagEmbeddingError) || errorCode !== 'EMBED_PROVIDER_TRANSIENT' || !error.retryable) {
    return { state: 'unknown', errorCode };
  }
  if (attempt.callLimitReached) return { state: 'unknown', errorCode: 'EMBED_CALL_LIMIT_REACHED' };
  if (attempt.retriesUsed >= MAX_RETRIES) return { state: 'unknown', errorCode: 'EMBED_RETRY_EXHAUSTED' };
  try {
    const delayMs = embeddingBackoffMs(attempt.retriesUsed, random, error.retryAfterMs);
    return { state: 'retryable', delayMs, errorCode };
  } catch (backoffError) {
    return { state: 'unknown', errorCode: sanitizedCode(backoffError) };
  }
}

/** Vector persistence and a successful attempt outcome must share the caller's transaction. */
export async function finishEmbeddingAttempt(
  tx: Transaction,
  attemptId: string,
  outcome: StoredOutcome,
  options: { onlyIfStarted?: boolean } = {},
): Promise<void> {
  await lockBudget(tx);
  const reported = 'reportedTokens' in outcome ? outcome.reportedTokens ?? null : null;
  const delay = outcome.state === 'retryable' ? outcome.delayMs : null;
  const errorCode = 'errorCode' in outcome ? outcome.errorCode : null;
  const { rows: [attempt] } = await tx.query<AttemptRow>(
    `UPDATE rag.embedding_attempt
     SET state = $2, reported_tokens = $3, error_code = $4, finished_at = clock_timestamp(),
         retry_at = CASE WHEN $5::integer IS NULL THEN NULL ELSE
           clock_timestamp() + $5::integer * interval '1 millisecond' END
     WHERE attempt_id = $1 AND state = 'started'
     RETURNING job_id, reserved_tokens`,
    [attemptId, outcome.state, reported, errorCode, delay],
  );
  if (!attempt) {
    if (options.onlyIfStarted) return;
    throw new RagEmbeddingError('EMBED_RESERVATION_MISMATCH');
  }

  if (reported !== null) {
    await tx.query(
      `UPDATE rag.embedding_reservation
       SET exposure_tokens = exposure_tokens - $2 + $3
       WHERE job_id = $1`,
      [attempt.job_id, attempt.reserved_tokens, reported],
    );
  }
}

/** Account for the response of a superseded claim without giving it write access to
 * the document, build, publication, or vector projection.
 */
export async function recordLateEmbeddingOutcome(
  tx: Transaction, attemptId: string, outcome: StoredOutcome,
): Promise<void> {
  if (outcome.state === 'succeeded') {
    return finishEmbeddingAttempt(tx, attemptId, {
      state: 'invalid', reportedTokens: outcome.reportedTokens, errorCode: 'EMBED_RECONCILIATION_REQUIRED',
    }, { onlyIfStarted: true });
  }
  if (outcome.state === 'retryable') {
    return finishEmbeddingAttempt(tx, attemptId, {
      state: 'unknown', errorCode: outcome.errorCode,
    }, { onlyIfStarted: true });
  }
  return finishEmbeddingAttempt(tx, attemptId, outcome, { onlyIfStarted: true });
}

export async function assertEmbeddingReservationComplete(tx: Transaction, jobId: string): Promise<void> {
  const reservation = await readEmbeddingReservation(tx, jobId);
  if (!reservation) return;
  const attempts = await readAttempts(tx, jobId);
  assertAttemptIdentities(reservation, attempts);
  assertUnambiguous(attempts);
  const completedAttempts = attempts.filter(attempt => attempt.state === 'succeeded');
  const completedBatches = new Set(completedAttempts.map(attempt => attempt.batch_index));
  if (completedAttempts.length !== reservation.batch_plan.length ||
      completedBatches.size !== completedAttempts.length) {
    throw new RagEmbeddingError('EMBED_RESERVATION_MISMATCH');
  }
}

/** A closed reservation keeps all known usage and unresolved exposure. Replays cannot release twice. */
export async function closeEmbeddingReservation(tx: Transaction, jobId: string): Promise<void> {
  await lockBudget(tx);
  await tx.query(
    'UPDATE rag.embedding_reservation SET closed_at = clock_timestamp() WHERE job_id = $1 AND closed_at IS NULL',
    [jobId],
  );
}

/** Operator-only. Confirmed consumption must come from the authoritative billing
 * evidence for a settled attempt. The original provider report remains available.
 */
export async function reconcileEmbeddingAttempt(
  tx: Transaction, attemptId: string, confirmedTokens: number,
): Promise<void> {
  if (!Number.isSafeInteger(confirmedTokens) || confirmedTokens < 0) {
    throw new RagEmbeddingError('EMBED_INVALID_INPUT');
  }
  const { rows: [job] } = await tx.query<{ job_id: string; document_id: string | null }>(
    `SELECT j.job_id, j.document_id
       FROM rag.embedding_attempt a JOIN rag.ingestion_job j USING (job_id)
       WHERE a.attempt_id = $1`, [attemptId],
  );
  if (!job) throw new RagEmbeddingError('EMBED_RESERVATION_MISMATCH');
  if (job.document_id) await lockDocument(tx, job.document_id);
  await lockBudget(tx);
  const { rows: [attempt] } = await tx.query<{
    exposure: string; reconciled_tokens: string | null;
  }>(`SELECT coalesce(a.reported_tokens, a.reserved_tokens)::text AS exposure, a.reconciled_tokens::text
      FROM rag.embedding_attempt a
      JOIN rag.embedding_reservation r USING (job_id)
      JOIN rag.ingestion_job j USING (job_id)
      WHERE a.attempt_id = $1 AND r.closed_at IS NOT NULL
        AND j.status IN ('succeeded', 'no_op', 'failed', 'cancelled')
        AND a.state IN ('started', 'retryable', 'unknown', 'overage')`, [attemptId]);
  if (!attempt || (attempt.reconciled_tokens !== null && Number(attempt.reconciled_tokens) !== confirmedTokens)) {
    throw new RagEmbeddingError('EMBED_RECONCILIATION_REQUIRED');
  }
  if (attempt.reconciled_tokens !== null) return;

  await tx.query(
    `UPDATE rag.embedding_attempt
     SET reconciled_tokens = $2, reconciled_at = clock_timestamp(),
         finished_at = coalesce(finished_at, clock_timestamp()),
         state = CASE WHEN state = 'started' THEN 'unknown' ELSE state END
     WHERE attempt_id = $1`, [attemptId, confirmedTokens],
  );
  await tx.query(
    'UPDATE rag.embedding_reservation SET exposure_tokens = exposure_tokens - $2 + $3 WHERE job_id = $1',
    [job.job_id, attempt.exposure, confirmedTokens],
  );
}
