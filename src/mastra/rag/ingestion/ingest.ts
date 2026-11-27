import { setTimeout as sleep } from 'node:timers/promises';
import { assessRenderedPublication } from '../contracts/publication.ts';
import {
  assertEmbeddingDispatchPermitted, assertEmbeddingReservationComplete, beginEmbeddingAttempt, closeEmbeddingReservation,
  finishEmbeddingAttempt, inspectEmbeddingFailure, inspectEmbeddingResponse, readEmbeddingReservation, recordLateEmbeddingOutcome,
  reserveEmbeddingPlan,
} from '../embeddings/durable-budget.ts';
import { RagEmbeddingError } from '../embeddings/errors.ts';
import { E2_MEASURED_TOKENIZER, prepareMeasuredEmbeddingPlan } from '../embeddings/measured-preflight.ts';
import type { EmbeddingProvider } from '../embeddings/provider.ts';
import {
  assertActiveSpace, assertLive, persistCatalog, prepareCatalog, readPublication, SPACE,
  type ValidatedIngestionInput,
} from './catalog.ts';
import { lockDocument, lockSource, withTransaction, type Pool, type Transaction } from './database.ts';
import { IngestionError } from './errors.ts';
import { claimJob, finishJob, renewClaim, retireStaleClaim, type Claim } from './jobs.ts';
import { readProjection, upsertProjection, verifyProjection } from './projection.ts';

type Checkpoint = 'before_reservation' | 'after_reservation' | 'after_attempt_start' |
  'after_response' | 'after_upsert' | 'before_publication';

type IngestionOptions = Readonly<{
  signal?: AbortSignal;
  checkpoint?: (point: Checkpoint) => Promise<void> | void;
}>;

const SPACE_ID = SPACE.spaceId;
const PROVIDER_CALL_TIMEOUT_MS = 30_000;

/** Internal operator service. The application registers no routes for this service.
 * The local entrypoint wires the deterministic fake provider exclusively.
 */
export async function ingestValidatedDocument(
  pool: Pool, provider: EmbeddingProvider, input: ValidatedIngestionInput, options: IngestionOptions = {},
) {
  try {
    return await ingest(pool, provider, input, options);
  } catch (error) {
    if (error instanceof IngestionError || error instanceof RagEmbeddingError) throw error;
    throw new IngestionError('E2_DATABASE_FAILURE');
  }
}

async function ingest(
  pool: Pool, provider: EmbeddingProvider, input: ValidatedIngestionInput, options: IngestionOptions,
) {
  let catalog: ReturnType<typeof prepareCatalog>;
  try {
    catalog = prepareCatalog(input);
  } catch (error) {
    if (error instanceof IngestionError) throw error;
    throw new IngestionError('E2_INPUT_INVALID');
  }
  const documentId = catalog.document.document_id;
  const sourceId = catalog.source.source_id;
  const chunkSetId = catalog.set.chunk_set_id;
  const observation = { chunkSetId, fetchedAt: catalog.version.fetched_at };
  const inputs = catalog.chunks.map(chunk => ({ chunkId: chunk.chunk_id, text: chunk.content }));
  const signal = options.signal ?? new AbortController().signal;

  function serialized<T>(action: (tx: Transaction) => Promise<T>) {
    return withTransaction(pool, async tx => {
      await lockSource(tx, sourceId);
      await lockDocument(tx, documentId);
      return action(tx);
    });
  }

  function owned<T>(claim: Claim, action: (tx: Transaction) => Promise<T>) {
    return serialized(async tx => {
      await assertLive(tx, sourceId, documentId);
      await assertActiveSpace(tx);
      await renewClaim(tx, claim);
      return action(tx);
    });
  }

  await options.checkpoint?.('before_reservation');
  if (signal.aborted) throw new RagEmbeddingError('EMBED_ABORTED');
  const admission = await serialized(async tx => {
    await assertActiveSpace(tx);
    const current = await readPublication(tx, documentId);
    const decision = assessRenderedPublication(current, observation);
    if (decision.outcome === 'stale') {
      await assertLive(tx, sourceId, documentId);
      if (current) await retireStaleClaim(tx, documentId, chunkSetId, current);
      return { outcome: 'stale' } as const;
    }
    await persistCatalog(tx, catalog);
    if (decision.outcome === 'no_op') {
      await verifyProjection(tx, catalog);
      const published = await tx.query(`SELECT 1 FROM rag.index_build
        WHERE chunk_set_id=$1 AND space_id=$2 AND status='published' AND embedded_count=$3`,
      [chunkSetId, SPACE_ID, catalog.chunks.length]);
      if (!published.rowCount) throw new IngestionError('E2_BUILD_INVALID');
      if (decision.advanceWatermark) {
        await tx.query(`UPDATE rag.document_publication SET version_fetched_at=$3
          WHERE document_id=$1 AND space_id=$2`, [documentId, SPACE_ID, observation.fetchedAt]);
      }
      return { outcome: 'no_op' } as const;
    }

    const claim = await claimJob(tx, catalog);
    const present = await readProjection(tx, catalog);
    const previousReservation = await readEmbeddingReservation(tx, claim.jobId);
    const originallyMissing = new Set(previousReservation?.batch_chunk_ids.flat() ?? []);
    const existing = previousReservation
      ? inputs.filter(chunk => !originallyMissing.has(chunk.chunkId)).map(chunk => chunk.chunkId)
      : [...present];
    if (existing.some(id => !present.has(id))) throw new IngestionError('E2_BUILD_INVALID');

    const plan = prepareMeasuredEmbeddingPlan(provider, inputs, existing);
    if (catalog.set.measured_tokenizer !== E2_MEASURED_TOKENIZER ||
        plan.chunks.some((chunk, index) => chunk.tokens !== catalog.chunks[index].measured_token_count ||
          chunk.bytes !== catalog.chunks[index].byte_count)) {
      throw new IngestionError('E2_IDENTITY_CONFLICT');
    }
    await reserveEmbeddingPlan(tx, claim.jobId, plan);
    await tx.query(`
      INSERT INTO rag.index_build (chunk_set_id, space_id, status, embedded_count)
      VALUES ($1,$2,'embedding',$3)
      ON CONFLICT (chunk_set_id,space_id) DO UPDATE SET status='embedding',
        embedded_count=EXCLUDED.embedded_count, updated_at=clock_timestamp(), error_code=NULL
    `, [chunkSetId, SPACE_ID, present.size]);
    await tx.query("UPDATE rag.ingestion_job SET stage='reserved' WHERE job_id=$1", [claim.jobId]);
    return { outcome: 'admitted', claim, plan } as const;
  });
  if (admission.outcome !== 'admitted') return { ...admission, documentId, chunkSetId };

  const { claim, plan } = admission;
  await options.checkpoint?.('after_reservation');
  for (const [batchIndex, batch] of plan.batches.entries()) {
    for (;;) {
      if (signal.aborted) throw new RagEmbeddingError('EMBED_ABORTED');
      const attempt = await owned(claim, async tx => {
        const next = await beginEmbeddingAttempt(tx, claim.jobId, batchIndex, batch);
        if (next.state === 'complete') {
          const present = await readProjection(tx, catalog);
          if (batch.chunks.some(chunk => !present.has(chunk.chunkId))) throw new IngestionError('E2_BUILD_INVALID');
        } else if (next.state === 'started') {
          await tx.query("UPDATE rag.ingestion_job SET stage='provider' WHERE job_id=$1", [claim.jobId]);
        }
        return next;
      });
      if (attempt.state === 'complete') break;
      if (attempt.state === 'wait') {
        try {
          await sleep(attempt.delayMs, undefined, { signal });
        } catch {
          throw new RagEmbeddingError('EMBED_ABORTED');
        }
        continue;
      }

      await options.checkpoint?.('after_attempt_start');
      await owned(claim, tx => assertEmbeddingDispatchPermitted(tx, attempt.attemptId));
      if (new Date().toISOString().slice(0, 10) !== attempt.utcDay) {
        throw new RagEmbeddingError('EMBED_RESERVATION_EXPIRED');
      }
      // No transaction is open during the provider call. Only a freshly
      // committed attempt may dispatch; an ambiguous start cannot replay.
      const callSignal = AbortSignal.any([signal, AbortSignal.timeout(PROVIDER_CALL_TIMEOUT_MS)]);
      const exactInputs = Object.freeze(batch.chunks.map(chunk => chunk.text));
      let outcome;
      try {
        if (callSignal.aborted) throw new RagEmbeddingError('EMBED_ABORTED');
        const response = await provider.embed(exactInputs, { signal: callSignal, purpose: 'document' });
        outcome = inspectEmbeddingResponse(response, batch);
      } catch (error) {
        outcome = inspectEmbeddingFailure(error, attempt);
      }
      await options.checkpoint?.('after_response');

      const committed = await owned(claim, async tx => {
        if ('vectors' in outcome) {
          await tx.query('SAVEPOINT vector_batch');
          try {
            await upsertProjection(tx, catalog, batch.chunks, outcome.vectors);
          } catch {
            // Still retain known usage when PostgreSQL definitively rolled
            // back the vector statement. A lost connection leaves a start.
            await tx.query('ROLLBACK TO SAVEPOINT vector_batch');
            const errorCode = 'EMBED_PROVIDER_FAILURE' as const;
            await finishEmbeddingAttempt(tx, attempt.attemptId,
              { state: 'invalid', errorCode, reportedTokens: outcome.reportedTokens });
            await failBuild(tx, claim, chunkSetId, errorCode);
            return errorCode;
          }
          await finishEmbeddingAttempt(tx, attempt.attemptId, outcome);
          await tx.query(`UPDATE rag.index_build SET embedded_count=embedded_count+$3,
            updated_at=clock_timestamp() WHERE chunk_set_id=$1 AND space_id=$2`,
          [chunkSetId, SPACE_ID, batch.chunks.length]);
          await tx.query("UPDATE rag.ingestion_job SET stage='vector_batch' WHERE job_id=$1", [claim.jobId]);
          return null;
        }
        await finishEmbeddingAttempt(tx, attempt.attemptId, outcome);
        if (outcome.state === 'retryable') return null;
        const errorCode = 'errorCode' in outcome ? outcome.errorCode : 'EMBED_RECONCILIATION_REQUIRED';
        await failBuild(tx, claim, chunkSetId, errorCode);
        return errorCode;
      }).catch(async error => {
        // Preserve usage after deletion, fencing, or an ambiguous commit
        // without allowing any late catalog writes.
        try {
          await withTransaction(pool, tx => recordLateEmbeddingOutcome(tx, attempt.attemptId, outcome));
        } catch {
          // A lost database leaves the durable start and its full exposure.
        }
        throw error;
      });
      if (committed) throw new RagEmbeddingError(committed);
      if (outcome.state === 'retryable') continue;
      await options.checkpoint?.('after_upsert');
      break;
    }
  }

  await options.checkpoint?.('before_publication');
  return owned(claim, async tx => {
    await verifyProjection(tx, catalog);
    await assertEmbeddingReservationComplete(tx, claim.jobId);
    const current = await readPublication(tx, documentId);
    const decision = assessRenderedPublication(current, { chunkSetId, fetchedAt: claim.observedAt });
    if (decision.outcome === 'publish') {
      if (current) {
        await tx.query(`UPDATE rag.index_build SET status='superseded', updated_at=clock_timestamp()
          WHERE chunk_set_id=$1 AND space_id=$2`, [current.chunkSetId, SPACE_ID]);
      }
      const build = await tx.query(`UPDATE rag.index_build SET status='published', embedded_count=$3,
        updated_at=clock_timestamp() WHERE chunk_set_id=$1 AND space_id=$2 AND status='embedding'`,
      [chunkSetId, SPACE_ID, catalog.chunks.length]);
      if (!build.rowCount) throw new IngestionError('E2_BUILD_INVALID');
      await tx.query(`
        INSERT INTO rag.document_publication
          (document_id,space_id,chunk_set_id,previous_chunk_set_id,version_fetched_at)
        VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT (document_id,space_id) DO UPDATE SET chunk_set_id=EXCLUDED.chunk_set_id,
          previous_chunk_set_id=EXCLUDED.previous_chunk_set_id, version_fetched_at=EXCLUDED.version_fetched_at,
          published_at=clock_timestamp()
      `, [documentId, SPACE_ID, chunkSetId, current?.chunkSetId ?? null, claim.observedAt]);
    } else if (decision.outcome === 'stale') {
      await tx.query(`UPDATE rag.index_build SET status='superseded', updated_at=clock_timestamp()
        WHERE chunk_set_id=$1 AND space_id=$2`, [chunkSetId, SPACE_ID]);
    } else {
      // Every in-scope pointer change follows the document fence, so a
      // different writer cannot install this same pointer during this claim.
      throw new IngestionError('E2_BUILD_INVALID');
    }
    await closeEmbeddingReservation(tx, claim.jobId);
    await finishJob(tx, claim, decision.outcome === 'publish' ? 'succeeded' : 'no_op', decision.outcome);
    return {
      outcome: decision.outcome === 'publish' ? 'published' as const : 'stale' as const,
      documentId, chunkSetId, jobId: claim.jobId, chunks: catalog.chunks.length,
      measuredTokens: catalog.set.measured_total_tokens, reservedTokens: plan.worstCaseTokenReservation,
    };
  });
}

async function failBuild(tx: Transaction, claim: Claim, chunkSetId: string, errorCode: string) {
  await tx.query(`UPDATE rag.index_build SET status='failed', error_code=$3, updated_at=clock_timestamp()
    WHERE chunk_set_id=$1 AND space_id=$2`, [chunkSetId, SPACE_ID, errorCode]);
  await closeEmbeddingReservation(tx, claim.jobId);
  await finishJob(tx, claim, 'failed', 'provider_or_projection', errorCode);
}
