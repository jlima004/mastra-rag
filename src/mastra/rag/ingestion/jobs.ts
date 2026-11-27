import { randomUUID } from 'node:crypto';
import { closeEmbeddingReservation } from '../embeddings/durable-budget.ts';
import { renderedIngestionIdempotencyKey } from '../contracts/ids.ts';
import { assessRenderedPublication, type PublishedRenderedSet } from '../contracts/publication.ts';
import type { Catalog } from './catalog.ts';
import { SPACE } from './catalog.ts';
import { lockDocument, lockSource, withTransaction, type Pool, type Transaction } from './database.ts';
import { IngestionError } from './errors.ts';

const OBSERVATION_SQL = `to_char(observed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
const LEASE_SQL = "clock_timestamp() + interval '90 seconds'";
export type Claim = Readonly<{ jobId: string; owner: string; fence: string; observedAt: string }>;

export async function claimJob(tx: Transaction, catalog: Catalog): Promise<Claim> {
  const documentId = catalog.document.document_id;
  const chunkSetId = catalog.set.chunk_set_id;
  const sourceId = catalog.source.source_id;
  const spaceId = SPACE.spaceId;
  const key = renderedIngestionIdempotencyKey(documentId, chunkSetId, spaceId);
  await tx.query(`
    INSERT INTO rag.ingestion_job
      (idempotency_key, idempotency_version, kind, source_id, document_id, space_id, rendered_chunk_set_id)
    VALUES ($1, 2, 'ingest', $2, $3, $4, $5)
    ON CONFLICT (idempotency_key) DO NOTHING
  `, [key, sourceId, documentId, spaceId, chunkSetId]);
  const byIdentity = await tx.query<{ job_id: string; status: string; attempt: number }>(`
    SELECT job_id, status, attempt FROM rag.ingestion_job WHERE idempotency_key=$1
      AND idempotency_version=2 AND kind='ingest' AND source_id=$2 AND document_id=$3
      AND space_id=$4 AND rendered_chunk_set_id=$5
  `, [key, sourceId, documentId, spaceId, chunkSetId]);
  const job = byIdentity.rows[0];
  if (!job) throw new IngestionError('E2_IDENTITY_CONFLICT');
  const observation = { chunkSetId, fetchedAt: catalog.version.fetched_at };
  const active = await tx.query<{
    job_id: string; expired: boolean; chunkSetId: string; versionFetchedAt: string | null;
  }>(`
    SELECT job_id, COALESCE(lease_expires_at <= clock_timestamp(), true) AS expired,
      rendered_chunk_set_id AS "chunkSetId", ${OBSERVATION_SQL} AS "versionFetchedAt"
    FROM rag.ingestion_job WHERE document_id=$1 AND space_id=$2 AND kind='ingest' AND status='running'
  `, [documentId, spaceId]);
  if (active.rows[0]) {
    const previous = active.rows[0];
    if (!previous.expired) throw new IngestionError('E2_JOB_BUSY');
    if (previous.job_id !== job.job_id) {
      if (!previous.versionFetchedAt || assessRenderedPublication({
        chunkSetId: previous.chunkSetId, versionFetchedAt: previous.versionFetchedAt,
      }, observation).outcome !== 'publish') throw new IngestionError('E2_JOB_BUSY');
      await retireExpiredJob(tx, previous.job_id);
    }
  }
  if (job.status === 'cancelled' || job.status === 'failed' ||
      job.attempt >= 4 && job.status !== 'succeeded' && job.status !== 'no_op') {
    throw new IngestionError('E2_JOB_BLOCKED');
  }
  const owner = randomUUID();
  const claimed = await tx.query<{ fence: string; observed_at: string }>(`
    UPDATE rag.ingestion_job
    SET status='running', stage='preflight', fence=fence+1, lease_owner=$2,
      lease_expires_at=${LEASE_SQL}, updated_at=clock_timestamp(), error_code=NULL,
      attempt=CASE WHEN status IN ('succeeded','no_op') THEN 1 ELSE attempt+1 END,
      observed_at=GREATEST(observed_at, $3::timestamptz)
    WHERE job_id=$1 RETURNING fence::text, ${OBSERVATION_SQL} AS observed_at
  `, [job.job_id, owner, observation.fetchedAt]);
  if (!claimed.rowCount) throw new IngestionError('E2_JOB_BLOCKED');
  return { jobId: job.job_id, owner, fence: claimed.rows[0].fence, observedAt: claimed.rows[0].observed_at };
}

export async function renewClaim(tx: Transaction, claim: Claim): Promise<void> {
  const result = await tx.query(`
    UPDATE rag.ingestion_job SET lease_expires_at=${LEASE_SQL}, updated_at=clock_timestamp()
    WHERE job_id=$1 AND lease_owner=$2 AND fence=$3 AND status='running'
      AND lease_expires_at > clock_timestamp()
  `, [claim.jobId, claim.owner, claim.fence]);
  if (!result.rowCount) throw new IngestionError('E2_JOB_FENCED');
}

export async function finishJob(
  tx: Transaction, claim: Claim, status: 'succeeded' | 'no_op' | 'failed', stage: string, errorCode?: string,
): Promise<void> {
  const done = await tx.query(`
    UPDATE rag.ingestion_job SET status=$4, stage=$5, error_code=$6, lease_owner=NULL,
      lease_expires_at=NULL, updated_at=clock_timestamp()
    WHERE job_id=$1 AND lease_owner=$2 AND fence=$3 AND status='running'
      AND lease_expires_at > clock_timestamp()
  `, [claim.jobId, claim.owner, claim.fence, status, stage, errorCode ?? null]);
  if (!done.rowCount) throw new IngestionError('E2_JOB_FENCED');
}

/** The document lock fences stale workers. Their attempts remain in the ledger. */
async function retireExpiredJob(
  tx: Transaction, jobId: string, stage: 'superseded_observation' | 'operator_cancelled' = 'superseded_observation',
): Promise<boolean> {
  const retired = await tx.query<{ rendered_chunk_set_id: string; space_id: string }>(`
    UPDATE rag.ingestion_job SET status='cancelled', stage=$2,
      fence=fence+1, lease_owner=NULL, lease_expires_at=NULL, updated_at=clock_timestamp()
    WHERE job_id=$1 AND status='running'
      AND (lease_expires_at IS NULL OR lease_expires_at <= clock_timestamp())
    RETURNING rendered_chunk_set_id, space_id
  `, [jobId, stage]);
  const job = retired.rows[0];
  if (!job) return false;
  await closeEmbeddingReservation(tx, jobId);
  await tx.query(`UPDATE rag.index_build SET status='failed', updated_at=clock_timestamp()
    WHERE chunk_set_id=$1 AND space_id=$2 AND status IN ('pending','embedding','verified')`,
  [job.rendered_chunk_set_id, job.space_id]);
  return true;
}

export async function retireStaleClaim(
  tx: Transaction, documentId: string, chunkSetId: string, current: PublishedRenderedSet,
): Promise<void> {
  const key = renderedIngestionIdempotencyKey(documentId, chunkSetId, SPACE.spaceId);
  const existing = await tx.query<{ job_id: string; observed_at: string | null }>(`
    SELECT job_id, ${OBSERVATION_SQL} AS observed_at FROM rag.ingestion_job
    WHERE idempotency_key=$1 AND document_id=$2 AND rendered_chunk_set_id=$3 AND kind='ingest'
      AND status='running'`, [key, documentId, chunkSetId]);
  const job = existing.rows[0];
  if (job?.observed_at && assessRenderedPublication(current, {
    chunkSetId, fetchedAt: job.observed_at,
  }).outcome === 'stale') await retireExpiredJob(tx, job.job_id);
}

/** Terminalize an expired job before settling an ambiguous provider attempt. */
export async function cancelExpiredIngestion(pool: Pool, jobId: string): Promise<boolean> {
  return withTransaction(pool, async tx => {
    const result = await tx.query<{ source_id: string; document_id: string }>(
      "SELECT source_id, document_id FROM rag.ingestion_job WHERE job_id=$1 AND kind='ingest'", [jobId]);
    const job = result.rows[0];
    if (!job) return false;
    await lockSource(tx, job.source_id);
    await lockDocument(tx, job.document_id);
    return retireExpiredJob(tx, jobId, 'operator_cancelled');
  });
}
