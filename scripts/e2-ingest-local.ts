import { reconcileEmbeddingAttempt } from '../src/mastra/rag/embeddings/durable-budget.ts';
import { withTransaction } from '../src/mastra/rag/ingestion/database.ts';
import { cancelExpiredIngestion } from '../src/mastra/rag/ingestion/jobs.ts';
import { canonicalJson, sha256 } from '../src/mastra/rag/contracts/ids.ts';
import { RagEmbeddingError } from '../src/mastra/rag/embeddings/errors.ts';
import { prepareCatalog } from '../src/mastra/rag/ingestion/catalog.ts';
import { IngestionError } from '../src/mastra/rag/ingestion/errors.ts';
import { createFakeEmbeddingProvider } from '../src/mastra/rag/ingestion/fake-provider.ts';
import { ingestValidatedDocument } from '../src/mastra/rag/ingestion/ingest.ts';
import {
  collectIngestionGarbage, deleteIngestedDocument, deleteIngestedSource,
} from '../src/mastra/rag/ingestion/retention.ts';
import {
  MVP_EXPERIMENTAL_CORPUS, MvpAdmissionError, validateMvpSnapshot,
} from '../src/mastra/rag/processing/mvp-corpus.ts';
import { openE2LocalPool } from './e2-local.ts';

const [command, value, proof, ...rest] = process.argv.slice(2);

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
try {
  if (rest.length || (command !== 'reconcile-attempt' && proof !== undefined) || (
    command === 'corpus' ? !value :
    command === 'gc' ? value !== undefined && value !== '--apply' :
    command === 'delete-document' ? !/^[0-9a-f]{64}$/.test(value ?? '') :
    command === 'cancel-expired-job' ? !uuid.test(value ?? '') :
    command === 'reconcile-attempt' ? !uuid.test(value ?? '') || !/^(?:0|[1-9][0-9]{0,15})$/.test(proof ?? '') :
    command === 'delete-source' ? !/^[a-z0-9][a-z0-9-]{2,79}$/.test(value ?? '') :
    true
  )) throw new Error('E2_LOCAL_USAGE_INVALID');

  const pool = await openE2LocalPool(command === 'reconcile-attempt' ? 'owner' : 'app');
  try {
    let result;
    if (command === 'corpus') {
      const fake = createFakeEmbeddingProvider();
      const docs = MVP_EXPERIMENTAL_CORPUS.snapshots.map(pin => validateMvpSnapshot(value, pin));
      const runs = [];
      for (const document of docs) {
        const catalog = prepareCatalog(document);
        const before = fake.calls();
        const first = await ingestValidatedDocument(pool, fake.provider, document);
        const firstCalls = fake.calls() - before;
        const replay = await ingestValidatedDocument(pool, fake.provider, document);
        runs.push({
          sourceId: document.source.sourceId, first, replay, firstCalls,
          replayCalls: fake.calls() - before - firstCalls,
          profileId: catalog.set.pipeline_profile_id,
          baseChunkSetId: catalog.set.base_chunk_set_id,
          orderedChunkIdsSha256: sha256(canonicalJson(catalog.chunks.map(chunk => chunk.chunk_id))),
          chunks: catalog.chunks.length,
          measuredTokens: catalog.set.measured_total_tokens,
          utf8Bytes: catalog.set.total_byte_budget,
          chunksOverLegacyByteLimit: catalog.chunks.filter(chunk => chunk.byte_count > 1024).length,
          chunksOverLegacyPreflight: catalog.chunks.filter(chunk => chunk.byte_count + 8 > 1024).length,
        });
      }
      result = { corpusManifestSha256: sha256(canonicalJson(MVP_EXPERIMENTAL_CORPUS)), runs };
    } else if (command === 'gc') {
      result = await collectIngestionGarbage(pool, { dryRun: value !== '--apply' });
    } else if (command === 'delete-document') {
      result = await deleteIngestedDocument(pool, value);
    } else if (command === 'delete-source') {
      result = await deleteIngestedSource(pool, value);
    } else if (command === 'cancel-expired-job') {
      result = { cancelled: await cancelExpiredIngestion(pool, value) };
    } else {
      await withTransaction(pool, tx => reconcileEmbeddingAttempt(tx, value, Number(proof)));
      result = { reconciled: true };
    }
    const output = JSON.stringify(result, null, 2);
    if (output.includes('"outcome": "E2_PURGE_RETRY_REQUIRED"')) process.exitCode = 1;
    process.stdout.write(output + '\n');
  } finally {
    await pool.end();
  }
} catch (error) {
  const code = error instanceof IngestionError || error instanceof RagEmbeddingError || error instanceof MvpAdmissionError
    ? error.code
    : error instanceof Error && ['E2_LOCAL_DATABASE_REQUIRED', 'E2_LOCAL_USAGE_INVALID'].includes(error.message)
      ? error.message : 'E2_LOCAL_OPERATION_FAILED';
  process.stderr.write(code + '\n');
  process.exitCode = 1;
}
