import { closeEmbeddingReservation } from '../embeddings/durable-budget.ts';
import { RAG_VECTOR_SPACE_ID } from '../../storage/supabase-runtime-probe.ts';
import { lockDocument, lockSource, withTransaction, type Pool, type Transaction } from './database.ts';
import { IngestionError } from './errors.ts';

const DOCUMENT_ID_PATTERN = /^[0-9a-f]{64}$/;
const SOURCE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,79}$/;
const PURGE_ERROR = 'E2_PURGE_RETRY_REQUIRED' as const;

type Build = { document_id: string; chunk_set_id: string; space_id: string };
type GarbageCollectionResult = Readonly<{
  documentId: string;
  chunkSetId: string;
  spaceId: string;
  outcome: 'eligible' | 'purged' | 'skipped' | typeof PURGE_ERROR;
}>;
export type DocumentPurgeResult = Readonly<{
  documentId: string;
  outcome: 'purged' | typeof PURGE_ERROR;
}>;

const GC_ELIGIBILITY_SQL = `
  SELECT cs.document_id, b.chunk_set_id, b.space_id
  FROM rag.index_build b
  JOIN rag.chunk_set cs USING (chunk_set_id)
  JOIN rag.document d USING (document_id)
  JOIN rag.source s USING (tenant_id, source_id)
  WHERE b.status IN ('superseded', 'failed')
    AND b.updated_at <= statement_timestamp() - INTERVAL '7 days'
    AND d.deleted_at IS NULL AND s.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT FROM rag.document_publication p
      WHERE p.document_id = cs.document_id AND p.space_id = b.space_id
        AND (
          p.chunk_set_id = b.chunk_set_id OR (
            p.previous_chunk_set_id = b.chunk_set_id
            AND p.published_at > statement_timestamp() - INTERVAL '7 days'
          )
        )
    )
    AND NOT EXISTS (
      SELECT FROM rag.ingestion_job j
      WHERE j.rendered_chunk_set_id = b.chunk_set_id AND j.space_id = b.space_id
        AND j.status IN ('queued', 'running')
    )
    AND NOT EXISTS (
      SELECT FROM rag.ingestion_job j
      JOIN rag.embedding_attempt a USING (job_id)
      WHERE j.rendered_chunk_set_id = b.chunk_set_id AND j.space_id = b.space_id
        AND a.reconciled_at IS NULL
        AND a.state IN ('started', 'retryable', 'unknown', 'overage')
    )
`;

// These queries operate on the E1-provisioned PgVector table through the same
// connection as the catalog mutation. DELETE and verification are transactionally
// fenced against publication and upserts, including during backend disconnects.
const VECTOR_TABLE = 'rag.chunks_te3s_1536_v1';
const VECTOR_FOR_SET = `(
  v.metadata->>'chunk_set_id' = $1 OR EXISTS (
    SELECT FROM rag.chunk c WHERE c.chunk_id = v.vector_id AND c.chunk_set_id = $1
  )
)`;
const VECTOR_FOR_DOCUMENT = `(
  v.metadata->>'document_id' = $1 OR EXISTS (
    SELECT FROM rag.chunk_set cs WHERE cs.document_id = $1
      AND (cs.chunk_set_id = v.metadata->>'chunk_set_id' OR EXISTS (
        SELECT FROM rag.chunk c WHERE c.chunk_set_id = cs.chunk_set_id AND c.chunk_id = v.vector_id
      ))
  )
)`;

async function runRetentionTransaction<T>(
  pool: Pool, work: (tx: Transaction) => Promise<T>,
): Promise<T> {
  try {
    return await withTransaction(pool, work);
  } catch (error) {
    if (error instanceof IngestionError) throw error;
    throw new IngestionError('E2_DATABASE_FAILURE');
  }
}

async function purgeVectors(
  tx: Transaction, target: 'document' | 'chunk_set', id: string,
): Promise<void> {
  const match = target === 'document' ? VECTOR_FOR_DOCUMENT : VECTOR_FOR_SET;
  const ownerColumn = target === 'document' ? 'document_id' : 'chunk_set_id';
  const targetDocument = target === 'document'
    ? '$1' : '(SELECT document_id FROM rag.chunk_set WHERE chunk_set_id = $1)';

  // A conflicting owner association needs a manual fix before deletion.
  // Include the deterministic ID lookup to detect drift even when metadata is absent.
  const conflicts = await tx.query(`
    SELECT 1 FROM ${VECTOR_TABLE} v
    WHERE v.namespace = 'public' AND ${match} AND (
      EXISTS (
        SELECT FROM rag.chunk_set cs WHERE cs.${ownerColumn} <> $1 AND (
          cs.chunk_set_id = v.metadata->>'chunk_set_id' OR EXISTS (
            SELECT FROM rag.chunk c WHERE c.chunk_set_id = cs.chunk_set_id AND c.chunk_id = v.vector_id
          )
        )
      ) OR EXISTS (
        SELECT FROM rag.document d WHERE d.document_id = v.metadata->>'document_id'
          AND d.document_id <> ${targetDocument}
      )
    ) LIMIT 1
  `, [id]);
  if (conflicts.rowCount !== 0) throw new IngestionError('E2_BUILD_INVALID');

  await tx.query(`DELETE FROM ${VECTOR_TABLE} v WHERE v.namespace = 'public' AND ${match}`, [id]);
  const remaining = await tx.query(`
    SELECT 1 FROM ${VECTOR_TABLE} v WHERE v.namespace = 'public' AND ${match} LIMIT 1
  `, [id]);
  if (remaining.rowCount !== 0) throw new IngestionError('E2_BUILD_INVALID');
}

async function scrubChunkSet(tx: Transaction, id: string): Promise<void> {
  const scrubbed = await tx.query(`
    UPDATE rag.chunk_set cs
    SET normalized_text = NULL, header_metadata_canonical_json = NULL, header_metadata_sha256 = NULL
    WHERE cs.chunk_set_id = $1
      AND NOT EXISTS (
        SELECT FROM rag.index_build b WHERE b.chunk_set_id = cs.chunk_set_id AND b.status <> 'purged'
      )
      AND NOT EXISTS (
        SELECT FROM rag.document_publication p
        WHERE p.chunk_set_id = cs.chunk_set_id OR p.previous_chunk_set_id = cs.chunk_set_id
      )
      AND NOT EXISTS (
        SELECT FROM rag.ingestion_job j WHERE j.rendered_chunk_set_id = cs.chunk_set_id
          AND j.status IN ('queued', 'running')
      )
    RETURNING cs.chunk_set_id
  `, [id]);
  if (scrubbed.rowCount) await tx.query('DELETE FROM rag.chunk WHERE chunk_set_id = $1', [id]);
}

async function purgeBuild(tx: Transaction, build: Build): Promise<'skipped' | 'purged'> {
  await lockDocument(tx, build.document_id);
  const eligible = await tx.query(`${GC_ELIGIBILITY_SQL}
    AND b.chunk_set_id = $1 AND b.space_id = $2
  `, [build.chunk_set_id, build.space_id]);
  if (eligible.rowCount === 0) return 'skipped';
  if (build.space_id !== RAG_VECTOR_SPACE_ID) throw new IngestionError('E2_SPACE_INVALID');

  await purgeVectors(tx, 'chunk_set', build.chunk_set_id);
  await tx.query(`
    UPDATE rag.document_publication SET previous_chunk_set_id = NULL
    WHERE document_id = $1 AND space_id = $2 AND previous_chunk_set_id = $3
  `, [build.document_id, build.space_id, build.chunk_set_id]);
  await tx.query(`
    UPDATE rag.index_build SET status = 'purged', embedded_count = 0, updated_at = clock_timestamp()
    WHERE chunk_set_id = $1 AND space_id = $2
  `, [build.chunk_set_id, build.space_id]);
  await scrubChunkSet(tx, build.chunk_set_id);
  return 'purged';
}

/** Manual operator-only application entrypoint. Default is read-only dry-run. */
export async function collectIngestionGarbage(
  pool: Pool, { dryRun = true }: { dryRun?: boolean } = {},
): Promise<readonly GarbageCollectionResult[]> {
  const builds = await runRetentionTransaction(pool, async tx => {
    const result = await tx.query<Build>(`${GC_ELIGIBILITY_SQL}
      ORDER BY cs.document_id, b.chunk_set_id, b.space_id
    `);
    return result.rows;
  });
  const outcomes: GarbageCollectionResult[] = [];
  for (const build of builds) {
    let outcome: GarbageCollectionResult['outcome'] = 'eligible';
    if (!dryRun) {
      try {
        outcome = await runRetentionTransaction(pool, tx => purgeBuild(tx, build));
      } catch {
        // Failed or uncertain commits get revalidated and verified on a later run.
        outcome = PURGE_ERROR;
      }
    }
    outcomes.push({
      documentId: build.document_id, chunkSetId: build.chunk_set_id, spaceId: build.space_id, outcome,
    });
  }
  return outcomes;
}

async function markDocumentDeleted(tx: Transaction, documentId: string): Promise<void> {
  await lockDocument(tx, documentId);
  const result = await tx.query(`
    UPDATE rag.document
    SET deleted_at = COALESCE(deleted_at, clock_timestamp()),
        purge_pending_at = CASE WHEN purged_at IS NULL THEN COALESCE(purge_pending_at, clock_timestamp()) END
    WHERE document_id = $1
  `, [documentId]);
  if (result.rowCount !== 1) throw new IngestionError('E2_INPUT_INVALID');

  await tx.query('DELETE FROM rag.document_publication WHERE document_id = $1', [documentId]);
  await tx.query(`
    UPDATE rag.ingestion_job SET status = 'cancelled', error_code = 'E2_DOCUMENT_DELETED',
      lease_owner = NULL, lease_expires_at = NULL, fence = fence + 1, updated_at = clock_timestamp()
    WHERE document_id = $1 AND status IN ('queued', 'running')
  `, [documentId]);
}

async function purgeDeletedDocument(pool: Pool, documentId: string): Promise<DocumentPurgeResult> {
  try {
    await runRetentionTransaction(pool, async tx => {
      await lockDocument(tx, documentId);
      const doc = await tx.query<{ purged_at: Date | null }>(`
        SELECT purged_at FROM rag.document WHERE document_id = $1 AND deleted_at IS NOT NULL
      `, [documentId]);
      if (!doc.rows[0]) throw new IngestionError('E2_INPUT_INVALID');
      if (doc.rows[0].purged_at) return;

      const unsupportedBuilds = await tx.query(`
        SELECT 1 FROM rag.index_build b JOIN rag.chunk_set cs USING (chunk_set_id)
        WHERE cs.document_id = $1 AND b.space_id <> $2 AND b.status <> 'purged' LIMIT 1
      `, [documentId, RAG_VECTOR_SPACE_ID]);
      if (unsupportedBuilds.rowCount) throw new IngestionError('E2_SPACE_INVALID');

      await purgeVectors(tx, 'document', documentId);
      await tx.query(`
        UPDATE rag.index_build b SET status = 'purged', embedded_count = 0, updated_at = clock_timestamp()
        FROM rag.chunk_set cs
        WHERE b.chunk_set_id = cs.chunk_set_id AND cs.document_id = $1 AND b.status <> 'purged'
      `, [documentId]);
      const sets = await tx.query<{ chunk_set_id: string }>(
        'SELECT chunk_set_id FROM rag.chunk_set WHERE document_id = $1', [documentId],
      );
      for (const set of sets.rows) await scrubChunkSet(tx, set.chunk_set_id);
      const remaining = await tx.query(`
        SELECT 1 FROM rag.chunk_set cs WHERE cs.document_id = $1 AND (
          cs.normalized_text IS NOT NULL OR EXISTS (SELECT FROM rag.chunk c WHERE c.chunk_set_id = cs.chunk_set_id)
        ) LIMIT 1
      `, [documentId]);
      if (remaining.rowCount !== 0) throw new IngestionError('E2_BUILD_INVALID');

      const jobs = await tx.query<{ job_id: string }>(
        'SELECT job_id FROM rag.ingestion_job WHERE document_id = $1 ORDER BY job_id', [documentId],
      );
      for (const job of jobs.rows) await closeEmbeddingReservation(tx, job.job_id);
      await tx.query(`
        UPDATE rag.document SET purge_pending_at = NULL, purge_error_code = NULL, purged_at = clock_timestamp()
        WHERE document_id = $1
      `, [documentId]);
    });
    return { documentId, outcome: 'purged' };
  } catch {
    try {
      const marked = await runRetentionTransaction(pool, tx => tx.query(`
        UPDATE rag.document SET purge_error_code = $2
        WHERE document_id = $1 AND purge_pending_at IS NOT NULL
      `, [documentId, PURGE_ERROR]));
      // The earlier commit may have succeeded even if its acknowledgement was lost.
      if (marked.rowCount === 0) {
        const confirmed = await runRetentionTransaction(pool, tx => tx.query(`
          SELECT 1 FROM rag.document WHERE document_id = $1 AND purged_at IS NOT NULL
        `, [documentId]));
        if (confirmed.rowCount === 1) return { documentId, outcome: 'purged' };
      }
    } catch {
      // Marking deletion committed before this purge. The durable pending marker survives.
    }
    return { documentId, outcome: PURGE_ERROR };
  }
}

export async function deleteIngestedDocument(pool: Pool, documentId: string): Promise<DocumentPurgeResult> {
  if (!DOCUMENT_ID_PATTERN.test(documentId)) throw new IngestionError('E2_INPUT_INVALID');
  await runRetentionTransaction(pool, tx => markDocumentDeleted(tx, documentId));
  return purgeDeletedDocument(pool, documentId);
}

/** Hold the source lock while marking all of its documents to fence first ingestion too. */
export async function deleteIngestedSource(pool: Pool, sourceId: string): Promise<readonly DocumentPurgeResult[]> {
  if (!SOURCE_ID_PATTERN.test(sourceId)) throw new IngestionError('E2_INPUT_INVALID');
  const documents = await runRetentionTransaction(pool, async tx => {
    await lockSource(tx, sourceId);
    const source = await tx.query(`
      UPDATE rag.source SET deleted_at = COALESCE(deleted_at, clock_timestamp())
      WHERE tenant_id = 'public' AND source_id = $1
    `, [sourceId]);
    if (source.rowCount !== 1) throw new IngestionError('E2_INPUT_INVALID');

    const docs = await tx.query<{ document_id: string }>(`
      SELECT document_id FROM rag.document
      WHERE tenant_id = 'public' AND source_id = $1 ORDER BY document_id
    `, [sourceId]);
    for (const doc of docs.rows) await markDocumentDeleted(tx, doc.document_id);
    return docs.rows;
  });
  const outcomes: DocumentPurgeResult[] = [];
  for (const doc of documents) outcomes.push(await purgeDeletedDocument(pool, doc.document_id));
  return outcomes;
}
