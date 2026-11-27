import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { after, test } from 'node:test';
import { documentId, sha256 } from '../src/mastra/rag/contracts/ids.ts';
import type { SourceManifestEntry } from '../src/mastra/rag/contracts/types.ts';
import { reconcileEmbeddingAttempt } from '../src/mastra/rag/embeddings/durable-budget.ts';
import { cancelExpiredIngestion } from '../src/mastra/rag/ingestion/jobs.ts';
import { prepareCatalog, type ValidatedIngestionInput } from '../src/mastra/rag/ingestion/catalog.ts';
import { withTransaction, type Transaction } from '../src/mastra/rag/ingestion/database.ts';
import { createFakeEmbeddingProvider } from '../src/mastra/rag/ingestion/fake-provider.ts';
import { ingestValidatedDocument } from '../src/mastra/rag/ingestion/ingest.ts';
import { collectIngestionGarbage, deleteIngestedDocument } from '../src/mastra/rag/ingestion/retention.ts';
import { DOU_EXTRACTOR_CANDIDATE } from '../src/mastra/rag/processing/dou-html.ts';
import { normalizeLegalBlocks } from '../src/mastra/rag/processing/legal.ts';
import { openE2LocalPool } from './e2-local.ts';

const app = await openE2LocalPool();
const owner = await openE2LocalPool('owner');
const db: Transaction = app;
const admin: Transaction = owner;
after(async () => { await Promise.all([app.end(), owner.end()]); });

const T1 = '2026-11-25T00:00:01.000Z';
const T2 = '2026-11-25T00:00:02.000Z';
const T3 = '2026-11-25T00:00:03.000Z';
const T4 = '2026-11-25T00:00:04.000Z';

function snapshot(name: string, version = 'v1', time = T1): ValidatedIngestionInput {
  const sourceId = 'synthetic-e2-' + name;
  const source: SourceManifestEntry = {
    sourceId, kind: 'http', tenantId: 'public', canonicalUri: 'https://example.invalid/' + sourceId,
    expectedMediaTypes: ['text/html'], extractor: 'dou-html@1',
    title: 'Matéria experimental para integração', license: { kind: 'other', reference: 'invented fixture' },
    language: 'pt-BR',
  };
  const text = 'Art. 1º Validação sintética 🧪 ' + version;
  const second = 'Art. 2º Segunda entrada verificável. '.repeat(20).trim();
  const bytes = Buffer.from('<p>' + text + '</p><p>' + second + '</p>');
  return {
    source: { ...source, extractor: DOU_EXTRACTOR_CANDIDATE },
    fetched: {
      sourceId, documentId: documentId('public', sourceId, source.canonicalUri),
      canonicalUri: source.canonicalUri, finalUri: source.canonicalUri, httpStatus: 200,
      declaredMediaType: 'text/html', sniffedMediaType: 'text/html', charset: 'utf-8',
      fetchedAt: time, contentSha256: sha256(bytes), byteSize: bytes.length, bytes,
    },
    normalized: normalizeLegalBlocks([{ kind: 'text', text }, { kind: 'text', text: second }], source),
  };
}

async function expire(input: ValidatedIngestionInput) {
  await admin.query(`UPDATE rag.ingestion_job SET lease_expires_at=clock_timestamp()-interval '1 second'
    WHERE document_id=$1 AND status='running'`, [input.fetched.documentId]);
}

async function view(input: ValidatedIngestionInput) {
  const id = input.fetched.documentId;
  const { rows } = await db.query<{
    pointer: string | null; previous: string | null; watermark: string | null;
    reservations: number; attempts: number; vectors: number; sets: number;
  }>(`SELECT
    (SELECT chunk_set_id FROM rag.document_publication WHERE document_id=$1) AS pointer,
    (SELECT previous_chunk_set_id FROM rag.document_publication WHERE document_id=$1) AS previous,
    (SELECT to_char(version_fetched_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      FROM rag.document_publication WHERE document_id=$1) AS watermark,
    (SELECT count(*)::int FROM rag.embedding_reservation JOIN rag.ingestion_job USING (job_id) WHERE document_id=$1)
      AS reservations,
    (SELECT count(*)::int FROM rag.embedding_attempt JOIN rag.ingestion_job USING (job_id) WHERE document_id=$1)
      AS attempts,
    (SELECT count(*)::int FROM rag.chunks_te3s_1536_v1 WHERE metadata->>'document_id'=$1 AND namespace='public')
      AS vectors,
    (SELECT count(*)::int FROM rag.chunk_set WHERE document_id=$1) AS sets`, [id]);
  return rows[0];
}

test('first publication, no-op, update, rollback, watermark and stale observations', async () => {
  const first = snapshot('publication');
  const group = createFakeEmbeddingProvider();
  const a = await ingestValidatedDocument(app, group.provider, first);
  assert.equal(a.outcome, 'published');
  const before = await view(first);
  assert.equal(before.pointer, a.chunkSetId);
  assert.equal(before.vectors, prepareCatalog(first).chunks.length);
  assert.equal((await ingestValidatedDocument(app, group.provider, snapshot('publication', 'v1', T2))).outcome, 'no_op');
  assert.deepEqual(await view(first), { ...before, watermark: T2 });
  assert.equal(group.calls(), 1);
  const b = await ingestValidatedDocument(app, group.provider, snapshot('publication', 'v2', T3));
  assert.equal(b.outcome, 'published');
  assert.equal((await view(first)).previous, a.chunkSetId);
  const reverted = await ingestValidatedDocument(app, group.provider, snapshot('publication', 'v1', T4));
  assert.equal(reverted.chunkSetId, a.chunkSetId);
  assert.equal(reverted.outcome, 'published');
  assert.equal((await view(first)).previous, b.chunkSetId);
  const live = await view(first);
  assert.equal((await ingestValidatedDocument(app, group.provider, snapshot('publication', 'older', T1))).outcome, 'stale');
  assert.deepEqual(await view(first), live);
  assert.equal(group.calls(), 2);

  // An extra ID carrying the same set identity is a verification failure.
  await admin.query(`INSERT INTO rag.chunks_te3s_1536_v1 (namespace, vector_id, embedding, metadata)
    SELECT namespace, $2, embedding, metadata FROM rag.chunks_te3s_1536_v1
      WHERE metadata->>'chunk_set_id'=$1 LIMIT 1`, [a.chunkSetId, sha256('unexpected-vector')]);
  await assert.rejects(ingestValidatedDocument(app, group.provider, first), { code: 'E2_BUILD_INVALID' });
  assert.equal(group.calls(), 2);
});

test('recover reservations and durable vector batches after lease expiry without repeating a call', async () => {
  for (const checkpoint of ['before_reservation', 'after_reservation', 'after_upsert', 'before_publication'] as const) {
    const input = snapshot(checkpoint.replaceAll('_', '-'));
    const fake = createFakeEmbeddingProvider();
    await assert.rejects(ingestValidatedDocument(app, fake.provider, input, {
      checkpoint(point) { if (point === checkpoint) throw new Error('synthetic checkpoint'); },
    }), { code: 'E2_DATABASE_FAILURE' });
    const partial = await view(input);
    assert.equal(partial.pointer, null);
    if (checkpoint === 'before_reservation') assert.equal(partial.reservations, 0);
    if (checkpoint === 'after_reservation') {
      assert.equal(partial.reservations, 1);
      assert.equal(fake.calls(), 0);
    }
    if (checkpoint === 'after_upsert' || checkpoint === 'before_publication') assert.equal(fake.calls(), 1);
    await expire(input);
    const resumed = await ingestValidatedDocument(app, fake.provider, input);
    assert.equal(resumed.outcome, 'published');
    assert.equal(fake.calls(), 1);
    assert.equal((await view(input)).attempts, 1);
  }
});

test('committed start and lost response are ambiguous and never replay automatically', async () => {
  for (const checkpoint of ['after_attempt_start', 'after_response'] as const) {
    const input = snapshot(checkpoint.replaceAll('_', '-'));
    const fake = createFakeEmbeddingProvider();
    await assert.rejects(ingestValidatedDocument(app, fake.provider, input, {
      checkpoint(point) { if (point === checkpoint) throw new Error('synthetic process loss'); },
    }), { code: 'E2_DATABASE_FAILURE' });
    const count = fake.calls();
    assert.equal(count, checkpoint === 'after_response' ? 1 : 0);
    await expire(input);
    await assert.rejects(ingestValidatedDocument(app, fake.provider, input), { code: 'EMBED_RECONCILIATION_REQUIRED' });
    assert.equal(fake.calls(), count);
    const current = await view(input);
    assert.equal(current.pointer, null);
    assert.equal(current.attempts, 1);
    assert.equal(current.vectors, 0);
  }
});

test('later watermark retires expired stale job and a newer version can proceed', async () => {
  const fake = createFakeEmbeddingProvider();
  const a = snapshot('stale-active');
  const b = snapshot('stale-active', 'v2', T2);
  await ingestValidatedDocument(app, fake.provider, a);
  await assert.rejects(ingestValidatedDocument(app, fake.provider, b, {
    checkpoint(point) { if (point === 'after_reservation') throw new Error('synthetic crash'); },
  }), { code: 'E2_DATABASE_FAILURE' });
  await ingestValidatedDocument(app, fake.provider, snapshot('stale-active', 'v1', T3));
  await expire(b);
  assert.equal((await ingestValidatedDocument(app, fake.provider, b)).outcome, 'stale');
  assert.equal((await ingestValidatedDocument(app, fake.provider, snapshot('stale-active', 'v3', T4))).outcome, 'published');
  assert.equal(fake.calls(), 2);
});

test('concurrent claim is rejected and deletion fences late vectors', async () => {
  const input = snapshot('late-writer');
  const events = new EventEmitter();
  const waiting = once(events, 'waiting');
  const fake = createFakeEmbeddingProvider(async () => {
    const release = once(events, 'release');
    events.emit('waiting');
    await release;
    return 'ok' as const;
  });
  const task = ingestValidatedDocument(app, fake.provider, input);
  const rejected = assert.rejects(task, { code: 'E2_DOCUMENT_DELETED' });
  await waiting;
  try {
    const competitor = createFakeEmbeddingProvider();
    await assert.rejects(ingestValidatedDocument(app, competitor.provider, input), { code: 'E2_JOB_BUSY' });
    assert.equal(competitor.calls(), 0);
    await collectIngestionGarbage(app, { dryRun: false });
    assert.equal((await view(input)).reservations, 1);
    await deleteIngestedDocument(app, input.fetched.documentId);
  } finally {
    events.emit('release');
  }
  await rejected;
  assert.equal((await view(input)).vectors, 0);
  assert.equal((await view(input)).pointer, null);
  await assert.rejects(ingestValidatedDocument(app, fake.provider, input), { code: 'E2_DOCUMENT_DELETED' });
});

test('definite PostgreSQL upsert failure retains reported usage and blocks publication', async () => {
  const input = snapshot('upsert-failure');
  const expected = prepareCatalog(input);
  const failureId = expected.chunks[0].chunk_id;
  // The only interpolation is a locally generated SHA-256, not external input.
  await admin.query(`CREATE FUNCTION rag.e2_test_reject_upsert() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.vector_id='${failureId}' THEN RAISE EXCEPTION 'synthetic vector failure'; END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER e2_test_reject_upsert BEFORE INSERT ON rag.chunks_te3s_1536_v1
      FOR EACH ROW EXECUTE FUNCTION rag.e2_test_reject_upsert();`);
  try {
    const fake = createFakeEmbeddingProvider();
    await assert.rejects(ingestValidatedDocument(app, fake.provider, input), { code: 'EMBED_PROVIDER_FAILURE' });
    assert.equal(fake.calls(), 1);
    const state = await view(input);
    assert.equal(state.pointer, null);
    assert.equal(state.vectors, 0);
    const { rows } = await db.query(`SELECT a.state, a.reported_tokens::integer AS tokens
      FROM rag.embedding_attempt a JOIN rag.ingestion_job j USING (job_id) WHERE j.document_id=$1`,
    [input.fetched.documentId]);
    assert.deepEqual(rows, [{ state: 'invalid', tokens: expected.set.measured_total_tokens }]);
  } finally {
    await admin.query(`DROP TRIGGER e2_test_reject_upsert ON rag.chunks_te3s_1536_v1;
      DROP FUNCTION rag.e2_test_reject_upsert()`);
  }
});

test('erasure between attempt commit and dispatch prevents the provider call', async () => {
  const input = snapshot('delete-before-dispatch');
  const fake = createFakeEmbeddingProvider();
  await assert.rejects(ingestValidatedDocument(app, fake.provider, input, {
    async checkpoint(point) {
      if (point === 'after_attempt_start') {
        assert.equal((await deleteIngestedDocument(app, input.fetched.documentId)).outcome, 'purged');
      }
    },
  }), { code: 'E2_DOCUMENT_DELETED' });
  assert.equal(fake.calls(), 0);
  assert.equal((await view(input)).attempts, 1);
  assert.equal((await view(input)).vectors, 0);
});

test('late overage after erasure is recorded without restoring vectors or permitting further calls', async () => {
  const input = snapshot('late-overage');
  const fake = createFakeEmbeddingProvider(async () => {
    assert.equal((await deleteIngestedDocument(app, input.fetched.documentId)).outcome, 'purged');
    return 'overage' as const;
  });
  await assert.rejects(ingestValidatedDocument(app, fake.provider, input), { code: 'E2_DOCUMENT_DELETED' });
  const { rows: [attempt] } = await db.query<{ attempt_id: string; state: string; tokens: number }>(
    `SELECT attempt_id, a.state, a.reported_tokens::integer AS tokens
     FROM rag.embedding_attempt a JOIN rag.ingestion_job j USING (job_id) WHERE j.document_id=$1`,
    [input.fetched.documentId]);
  assert.equal(attempt.state, 'overage');
  assert.equal(attempt.tokens, prepareCatalog(input).set.measured_total_tokens + 1);
  assert.equal((await view(input)).vectors, 0);
  const next = createFakeEmbeddingProvider();
  await assert.rejects(ingestValidatedDocument(app, next.provider, snapshot('global-overage-block')),
    { code: 'EMBED_RECONCILIATION_REQUIRED' });
  assert.equal(next.calls(), 0);
  await withTransaction(owner, tx => reconcileEmbeddingAttempt(tx, attempt.attempt_id, attempt.tokens));
});

test('older observation cannot cancel a newer expired job and recovery can still publish it', async () => {
  const first = snapshot('expired-observation');
  const old = snapshot('expired-observation', 'v2', T2);
  const fresh = snapshot('expired-observation', 'v3', T3);
  const fake = createFakeEmbeddingProvider();
  await ingestValidatedDocument(app, fake.provider, first);
  await assert.rejects(ingestValidatedDocument(app, fake.provider, fresh, {
    checkpoint(point) { if (point === 'after_upsert') throw new Error('synthetic crash'); },
  }), { code: 'E2_DATABASE_FAILURE' });
  await expire(fresh);
  await assert.rejects(ingestValidatedDocument(app, fake.provider, old), { code: 'E2_JOB_BUSY' });
  assert.equal((await ingestValidatedDocument(app, fake.provider, fresh)).outcome, 'published');
  assert.equal(fake.calls(), 2);
});

test('connection loss inside upsert rolls back vectors and does not authorize replay', async () => {
  const input = snapshot('upsert-connection-loss');
  const failureId = prepareCatalog(input).chunks[0].chunk_id;
  await admin.query(`CREATE FUNCTION rag.e2_test_drop_connection() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.vector_id='${failureId}' THEN
        PERFORM pg_terminate_backend(pg_backend_pid());
        PERFORM pg_sleep(1);
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER e2_test_drop_connection BEFORE INSERT ON rag.chunks_te3s_1536_v1
      FOR EACH ROW EXECUTE FUNCTION rag.e2_test_drop_connection();`);
  try {
    const fake = createFakeEmbeddingProvider();
    await assert.rejects(ingestValidatedDocument(app, fake.provider, input), { code: 'E2_DATABASE_FAILURE' });
    const state = await view(input);
    assert.equal(state.pointer, null);
    assert.equal(state.vectors, 0);
    assert.equal(state.attempts, 1);
    await expire(input);
    await assert.rejects(ingestValidatedDocument(app, fake.provider, input), { code: 'EMBED_RECONCILIATION_REQUIRED' });
    assert.equal(fake.calls(), 1);
    const { rows: [job] } = await db.query<{ job_id: string }>(
      "SELECT job_id FROM rag.ingestion_job WHERE document_id=$1 AND status='running'", [input.fetched.documentId]);
    await expire(input);
    assert.equal(await cancelExpiredIngestion(app, job.job_id), true);
    assert.equal(await cancelExpiredIngestion(app, job.job_id), false);
  } finally {
    await admin.query(`DROP TRIGGER e2_test_drop_connection ON rag.chunks_te3s_1536_v1;
      DROP FUNCTION rag.e2_test_drop_connection()`);
  }
});

test('known transient responses can retry and invalid or ambiguous responses cannot publish', async () => {
  const retries = createFakeEmbeddingProvider(call => call === 1 ? '429' : call === 2 ? '5xx' : 'ok');
  assert.equal((await ingestValidatedDocument(app, retries.provider, snapshot('transient-provider'))).outcome, 'published');
  assert.equal(retries.calls(), 3);
  for (const [mode, code] of [
    ['timeout', 'EMBED_ABORTED'], ['absent_usage', 'EMBED_USAGE_INVALID'],
    ['invalid_usage', 'EMBED_USAGE_INVALID'], ['wrong_dimension', 'EMBED_DIMENSION_MISMATCH'],
    ['nonfinite', 'EMBED_NONFINITE_VECTOR'], ['permanent', 'EMBED_PROVIDER_FAILURE'],
  ] as const) {
    const input = snapshot(mode.replaceAll('_', '-'));
    const fake = createFakeEmbeddingProvider(() => mode);
    await assert.rejects(ingestValidatedDocument(app, fake.provider, input), { code });
    const state = await view(input);
    assert.equal(fake.calls(), 1);
    assert.equal(state.pointer, null);
    assert.equal(state.vectors, 0);
    assert.equal(state.attempts, 1);
  }
});

test('physical PgVector dimension drift blocks admission before dispatch', async () => {
  const input = snapshot('wrong-physical-space');
  await admin.query(`ALTER TABLE rag.chunks_te3s_1536_v1 RENAME COLUMN embedding TO e2_fixture_embedding;
    ALTER TABLE rag.chunks_te3s_1536_v1 ADD COLUMN embedding extensions.vector(768)`);
  try {
    const fake = createFakeEmbeddingProvider();
    await assert.rejects(ingestValidatedDocument(app, fake.provider, input), { code: 'E2_SPACE_INVALID' });
    assert.equal(fake.calls(), 0);
    assert.equal((await view(input)).reservations, 0);
  } finally {
    await admin.query(`ALTER TABLE rag.chunks_te3s_1536_v1 DROP COLUMN embedding;
      ALTER TABLE rag.chunks_te3s_1536_v1 RENAME COLUMN e2_fixture_embedding TO embedding`);
  }
});
