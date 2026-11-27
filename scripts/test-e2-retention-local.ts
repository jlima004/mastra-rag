import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { sha256 } from '../src/mastra/rag/contracts/ids.ts';
import { countH9Cl100kTokens } from '../src/mastra/rag/processing/cl100k-counter.ts';
import {
  collectIngestionGarbage, deleteIngestedDocument, deleteIngestedSource,
} from '../src/mastra/rag/ingestion/retention.ts';
import { lockDocument, type Transaction } from '../src/mastra/rag/ingestion/database.ts';
import {
  RAG_VECTOR_SPACE_ID as spaceId, RUNTIME_VECTOR_POLICIES_CONTRACT_SQL as policyContract,
} from '../src/mastra/storage/supabase-runtime-probe.ts';
import { openE2LocalPool } from './e2-local.ts';

const sourceId = 'synthetic-e2-retention';
const documentId = sha256(sourceId);
const otherDocumentId = sha256(sourceId + '-other');
const otherSpaceId = 'chunks_e2_retention_test';

async function seedBuild(
  tx: Transaction, name: string, status: string, daysOld: number, docId = documentId,
) {
  const version = sha256(name + '-version');
  const set = sha256(name + '-rendered');
  const chunk = sha256(name + '-chunk');
  const text = ' '.repeat(1030) + ' retention fixture';
  const bytes = Buffer.byteLength(text);
  const tokens = countH9Cl100kTokens(text);

  await tx.query(`INSERT INTO rag.document_version
    (version_id,document_id,content_sha256,final_uri,media_type,charset,byte_size,fetched_at)
    VALUES ($1,$2,$1,'https://example.test/e2-retention','text/html','utf-8',200,now())`,
  [version, docId]);
  await tx.query(`INSERT INTO rag.chunk_set
    (chunk_set_id,base_chunk_set_id,rendering_identity_version,version_id,document_id,pipeline_profile_id,
     pipeline_profile,normalized_text,normalized_sha256,effective_charset,header_metadata_canonical_json,
     header_metadata_sha256,chunk_count,total_byte_budget,measured_total_tokens,measured_tokenizer)
    VALUES ($1,$2,'rag:chunkset-rendered:v2',$3,$4,$5,'{}',$6,$7,'utf-8',$8,$9,1,$10,$11,
     'cl100k_base/js-tiktoken@1.0.21')`,
  [set, sha256(name + '-base'), version, docId, sha256('profile'), text, sha256(text),
    '{"title":"synthetic fixture"}', sha256('{"title":"synthetic fixture"}'), bytes, tokens]);
  await tx.query(`INSERT INTO rag.chunk
    (chunk_id,chunk_set_id,ordinal,content,content_sha256,byte_count,measured_token_count,measured_tokenizer,
     char_start,char_end,heading_path,legal_unit_ids)
    VALUES ($1,$2,0,$3,$4,$5,$6,'cl100k_base/js-tiktoken@1.0.21',0,$7,'{}','{synthetic}')`,
  [chunk, set, text, sha256(text), bytes, tokens, text.length]);
  await tx.query(`INSERT INTO rag.index_build (chunk_set_id,space_id,status,embedded_count,updated_at)
    VALUES ($1,$2,$3,1,now()-$4::integer*interval '1 day')`, [set, spaceId, status, daysOld]);
  await tx.query(`INSERT INTO rag.chunks_te3s_1536_v1 (vector_id,embedding,metadata,namespace)
    VALUES ($1,('[1,' || repeat('0,',1534) || '0]')::extensions.vector(1536),
       jsonb_build_object('document_id',$2::text,'chunk_set_id',$3::text,'chunk_id',$1::text),'public')`,
  [chunk, docId, set]);
  return { set, chunk, version };
}

async function verifyRetention() {
  const app = await openE2LocalPool();
  const owner = await openE2LocalPool('owner');
  const appDb: Transaction = app;
  try {
    // Test fixtures are synthetic and only constructed after the local marker check.
    await app.query(`INSERT INTO rag.source (source_id,kind,canonical_uri,license_kind,license_ref)
      VALUES ($1,'http','https://example.test/e2-retention','other','synthetic')`, [sourceId]);
    await app.query(`INSERT INTO rag.document (document_id,source_id,canonical_uri,title)
      VALUES ($1,$2,'https://example.test/e2-retention','Synthetic'),
             ($3,$2,'https://example.test/e2-retention/other','Synthetic')`, [documentId, sourceId, otherDocumentId]);

    const current = await seedBuild(app, 'e2-retention-current', 'published', 10);
    const previous = await seedBuild(app, 'e2-retention-previous', 'superseded', 8);
    const failed = await seedBuild(app, 'e2-retention-failed', 'failed', 8);
    const recent = await seedBuild(app, 'e2-retention-recent', 'failed', 6);
    const reused = await seedBuild(app, 'e2-retention-reused', 'superseded', 8);
    const uncertain = await seedBuild(app, 'e2-retention-uncertain', 'failed', 8);
    const active = await seedBuild(app, 'e2-retention-active', 'failed', 8);
    const second = await seedBuild(app, 'e2-retention-other', 'verified', 1, otherDocumentId);
    await app.query(`INSERT INTO rag.document_publication
      (document_id,space_id,chunk_set_id,previous_chunk_set_id,version_fetched_at,published_at)
      VALUES ($1,$2,$3,$4,now(),now()-interval '2 days')`, [documentId, spaceId, current.set, previous.set]);

    await owner.query(`INSERT INTO rag.embedding_space
      (space_id,provider,embedding_model,embedding_version,dimension,metric,vector_type)
      VALUES ($1,'openai','synthetic-retention-test',1,1536,'cosine','vector')`, [otherSpaceId]);
    await app.query(`INSERT INTO rag.index_build (chunk_set_id,space_id,status)
      VALUES ($1,$2,'pending')`, [reused.set, otherSpaceId]);

    await app.query(`INSERT INTO rag.ingestion_job
      (idempotency_key,idempotency_version,kind,source_id,document_id,space_id,rendered_chunk_set_id,status)
      VALUES ($1,2,'ingest',$2,$3,$4,$5,'queued')`,
    [sha256('retention-queued-job'), sourceId, documentId, spaceId, active.set]);
    const job = (await appDb.query<{job_id: string}>(`INSERT INTO rag.ingestion_job
      (idempotency_key,idempotency_version,kind,source_id,document_id,space_id,rendered_chunk_set_id,status)
      VALUES ($1,2,'ingest',$2,$3,$4,$5,'failed') RETURNING job_id`,
    [sha256('retention-uncertain-job'), sourceId, documentId, spaceId, uncertain.set])).rows[0].job_id;
    await owner.query(`INSERT INTO rag.embedding_reservation
      (job_id,purpose,model_id,space_id,utc_day,measured_tokens,reserved_tokens,estimated_micro_usd,
       batch_plan,exposure_tokens)
      VALUES ($1,'ingestion','openai/text-embedding-3-small',$2,'2000-01-01',10,40,1,'[{}]',10)`,
    [job, spaceId]);
    await app.query(`INSERT INTO rag.embedding_attempt
      (job_id,batch_index,attempt_number,input_hash,reserved_tokens)
      VALUES ($1,0,1,$2,10)`, [job, sha256('retention-uncertain-input')]);

    const forDocument = (results: Awaited<ReturnType<typeof collectIngestionGarbage>>) =>
      results.filter(result => result.documentId === documentId);
    const dryRun = forDocument(await collectIngestionGarbage(app));
    assert.deepEqual(new Set(dryRun.map(result => result.chunkSetId)), new Set([failed.set, reused.set]));
    assert.ok(dryRun.every(result => result.outcome === 'eligible'));

    await assert.rejects(() => app.query(`
      UPDATE rag.chunk SET measured_token_count=1025 WHERE chunk_id=$1`,
    [failed.chunk]), { code: '23514' });
    await assert.rejects(() => app.query(`
      UPDATE rag.chunk SET byte_count=byte_count+1 WHERE chunk_id=$1`,
    [failed.chunk]), { code: '23514' });
    const before = await app.query('SELECT 1 FROM rag.chunks_te3s_1536_v1 WHERE vector_id = $1', [failed.chunk]);
    assert.equal(before.rowCount, 1);
    const gc = forDocument(await collectIngestionGarbage(app, { dryRun: false }));
    assert.equal(gc.length, 2);
    assert.ok(gc.every(result => result.outcome === 'purged'));
    assert.equal(forDocument(await collectIngestionGarbage(app, { dryRun: false })).length, 0);

    const readChunks = async () => new Set((await appDb.query<{chunk_id: string}>(`
      SELECT c.chunk_id FROM rag.chunk c JOIN rag.chunk_set cs USING (chunk_set_id)
      WHERE cs.document_id = $1`, [documentId])).rows.map(row => row.chunk_id));
    assert.deepEqual(await readChunks(), new Set([
      current.chunk, previous.chunk, recent.chunk, reused.chunk, uncertain.chunk, active.chunk,
    ]));
    const purgedSet = (await appDb.query<{ normalized_text: string|null; header_metadata_canonical_json: string|null }>(
      'SELECT normalized_text, header_metadata_canonical_json FROM rag.chunk_set WHERE chunk_set_id=$1', [failed.set],
    )).rows[0];
    assert.deepEqual(purgedSet, { normalized_text: null, header_metadata_canonical_json: null });

    // Collector picks up the aged rollback target, then waits while a publisher
    // restores that target using the exact source-of-truth transaction lock.
    await app.query(`UPDATE rag.document_publication SET published_at=now()-interval '8 days'
      WHERE document_id=$1 AND space_id=$2`, [documentId, spaceId]);
    const publisher = await owner.connect();
    let collection: ReturnType<typeof collectIngestionGarbage> | undefined;
    try {
      await publisher.query('BEGIN');
      await lockDocument(publisher, documentId);
      collection = collectIngestionGarbage(app, { dryRun: false });
      let waiting = false;
      for (let retry = 0; retry < 100 && !waiting; retry++) {
        const probe = await owner.query(`SELECT 1 FROM pg_catalog.pg_stat_activity
          WHERE usename='rag_app' AND wait_event='advisory' AND query LIKE '%rag:doc:%'`);
        waiting = probe.rowCount === 1;
        if (!waiting) await sleep(25);
      }
      assert.ok(waiting);
      await publisher.query(`UPDATE rag.document_publication
        SET chunk_set_id=$3,previous_chunk_set_id=$4,published_at=now()
        WHERE document_id=$1 AND space_id=$2`, [documentId, spaceId, previous.set, current.set]);
      await publisher.query(`UPDATE rag.index_build SET status='published' WHERE chunk_set_id=$1 AND space_id=$2`,
        [previous.set, spaceId]);
      await publisher.query(`UPDATE rag.index_build SET status='superseded',updated_at=now()
        WHERE chunk_set_id=$1 AND space_id=$2`, [current.set, spaceId]);
      await publisher.query('COMMIT');
    } catch (error) {
      await publisher.query('ROLLBACK');
      if (collection) await collection;
      throw error;
    } finally {
      publisher.release();
    }
    assert.ok(collection);
    const concurrent = forDocument(await collection);
    assert.deepEqual(concurrent.map(result => [result.chunkSetId,result.outcome]), [[previous.set,'skipped']]);

    // Simulate an operator-only failure by planting conflicting, known set metadata.
    // The vector still belongs to the second document. First-document erasure must
    // commit invisibility but refuse to remove unrelated vectors or scrub their owner.
    await owner.query(`UPDATE rag.index_build SET status='purged'
      WHERE chunk_set_id=$1 AND space_id=$2`, [reused.set, otherSpaceId]);
    await owner.query(`UPDATE rag.chunks_te3s_1536_v1
      SET metadata=jsonb_set(metadata,'{document_id}',to_jsonb($1::text))
      WHERE vector_id=$2 AND namespace='public'`, [documentId, second.chunk]);
    await owner.query(`INSERT INTO rag.chunks_te3s_1536_v1 (vector_id,embedding,metadata,namespace)
      SELECT vector_id,embedding,metadata,'other' FROM rag.chunks_te3s_1536_v1
      WHERE vector_id=$1 AND namespace='public'`, [current.chunk]);

    const partial = await deleteIngestedDocument(app, documentId);
    assert.equal(partial.outcome, 'E2_PURGE_RETRY_REQUIRED');
    const pending = await app.query(`SELECT 1 FROM rag.document d WHERE d.document_id=$1
      AND d.deleted_at IS NOT NULL AND d.purge_pending_at IS NOT NULL AND d.purged_at IS NULL
      AND d.purge_error_code='E2_PURGE_RETRY_REQUIRED'
      AND NOT EXISTS (SELECT FROM rag.document_publication p WHERE p.document_id=d.document_id)`, [documentId]);
    assert.equal(pending.rowCount, 1);

    await owner.query(`UPDATE rag.chunks_te3s_1536_v1
      SET metadata=jsonb_set(metadata,'{document_id}',to_jsonb($1::text))
      WHERE vector_id=$2 AND namespace='public'`, [otherDocumentId, second.chunk]);
    assert.equal((await deleteIngestedDocument(app, documentId)).outcome, 'purged');
    assert.equal((await deleteIngestedDocument(app, documentId)).outcome, 'purged');
    assert.equal((await readChunks()).size, 0);
    assert.equal((await app.query(`SELECT 1 FROM rag.chunks_te3s_1536_v1
      WHERE namespace='public' AND metadata->>'document_id'=$1`, [documentId])).rowCount, 0);
    const retainedOtherNamespace = await owner.query(`SELECT 1 FROM rag.chunks_te3s_1536_v1
      WHERE vector_id=$1 AND namespace='other'`, [current.chunk]);
    assert.equal(retainedOtherNamespace.rowCount, 1);
    const cannotDeleteOtherNamespace = await app.query(`DELETE FROM rag.chunks_te3s_1536_v1
      WHERE vector_id=$1 AND namespace='other'`, [current.chunk]);
    assert.equal(cannotDeleteOtherNamespace.rowCount, 0);

    const evidence = await app.query(`SELECT 1 FROM rag.embedding_reservation r
      JOIN rag.embedding_attempt a USING (job_id)
      WHERE r.job_id=$1 AND r.held_tokens=10 AND r.closed_at IS NOT NULL AND a.state='started'`, [job]);
    assert.equal(evidence.rowCount, 1);
    assert.equal((await app.query('SELECT 1 FROM rag.document_version WHERE version_id=$1', [current.version])).rowCount, 1);
    assert.equal((await app.query(`SELECT 1 WHERE ${policyContract}`)).rowCount, 1);
    const unsafePolicy = await owner.connect();
    try {
      await unsafePolicy.query('BEGIN');
      await unsafePolicy.query(`ALTER POLICY rag_vector_delete ON rag.chunks_te3s_1536_v1
        USING (namespace='public' OR true)`);
      assert.equal((await unsafePolicy.query(`SELECT 1 WHERE ${policyContract}`)).rowCount, 0);
    } finally {
      await unsafePolicy.query('ROLLBACK');
      unsafePolicy.release();
    }
    assert.equal((await app.query(`SELECT 1 WHERE current_user='rag_app'
      AND row_security_active('rag.embedding_reservation'::regclass)
      AND row_security_active('rag.embedding_attempt'::regclass)
      AND NOT has_table_privilege(current_user,'rag.embedding_attempt','DELETE')
      AND NOT has_column_privilege(current_user,'rag.embedding_attempt','reconciled_at','UPDATE')
      AND NOT has_schema_privilege(current_user,'rag','CREATE')`)).rowCount, 1);
    const removed = await deleteIngestedSource(app, sourceId);
    assert.deepEqual(removed.map(result => result.outcome), ['purged', 'purged']);
    assert.equal((await app.query(`SELECT 1 FROM rag.source WHERE source_id=$1 AND deleted_at IS NOT NULL`,
      [sourceId])).rowCount, 1);
    assert.equal((await app.query(`SELECT 1 FROM rag.chunks_te3s_1536_v1 WHERE vector_id=$1`,
      [second.chunk])).rowCount, 0);
  } finally {
    await Promise.all([app.end(), owner.end()]);
  }
}

await verifyRetention();
process.stdout.write('E2_RETENTION_GC_RLS_PG17_PASS\n');
