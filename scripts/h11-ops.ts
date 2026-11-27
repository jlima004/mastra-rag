import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RAG_LIMITS } from '../src/mastra/rag/contracts/types.ts';
import { readEmbeddingBudget } from '../src/mastra/rag/embeddings/durable-budget.ts';
import { RagEmbeddingError } from '../src/mastra/rag/embeddings/errors.ts';
import { E2_MEASURED_TOKENIZER, prepareMeasuredEmbeddingPlan } from '../src/mastra/rag/embeddings/measured-preflight.ts';
import {
  assertDirectOpenAITransport, createOpenAIEmbeddingProvider, hasOpenAIEmbeddingCredential, OPENAI_EMBEDDING_CONFIG,
} from '../src/mastra/rag/embeddings/openai.ts';
import {
  estimateH11EmbeddingCostMicroUsd, H11_MVP_POLICY, quoteH11OfflineReservation,
} from '../src/mastra/rag/embeddings/spend-policy.ts';
import { prepareCatalog, readPublication, SPACE } from '../src/mastra/rag/ingestion/catalog.ts';
import { withTransaction, type Pool, type Transaction } from '../src/mastra/rag/ingestion/database.ts';
import { IngestionError } from '../src/mastra/rag/ingestion/errors.ts';
import { ingestValidatedDocument } from '../src/mastra/rag/ingestion/ingest.ts';
import { readProjection } from '../src/mastra/rag/ingestion/projection.ts';
import {
  MVP_EXPERIMENTAL_CORPUS, MvpAdmissionError, validateMvpSnapshot,
} from '../src/mastra/rag/processing/mvp-corpus.ts';
import { SUPABASE_PROJECT_REF } from '../src/mastra/storage/supabase-config.ts';
import {
  RUNTIME_VECTOR_KEY_CONTRACT_SQL, RUNTIME_VECTOR_POLICIES_CONTRACT_SQL,
  RUNTIME_VECTOR_TYPE_CONTRACT_SQL, verifySupabaseRuntimeReadonly,
} from '../src/mastra/storage/supabase-runtime-probe.ts';
import { createSupabaseVectorStore } from '../src/mastra/storage/supabase-vector.ts';

const FIRST_SOURCE = 'br-anpd-res-18-2024';
const FIRST_CALL_LIMIT = 1;

type Command =
  | { kind: 'preflight' }
  | { kind: 'dry-run'; directory: string }
  | { kind: 'execute'; directory: string; sourceId: typeof FIRST_SOURCE; maxProviderCalls: 1 };

class OpsError extends Error {}

export function parseH11Command(args: readonly string[]): Command {
  if (args.length === 1 && args[0] === 'preflight') return { kind: 'preflight' };
  if (args.length === 2 && args[0] === 'dry-run' && directoryArg(args[1])) {
    return { kind: 'dry-run', directory: args[1] };
  }
  if (args.length === 5 && args[0] === 'execute' && args[1] === FIRST_SOURCE && directoryArg(args[2]) &&
      args[3] === '--confirm-paid-openai' && args[4] === '--max-provider-calls=1') {
    return { kind: 'execute', directory: args[2], sourceId: FIRST_SOURCE, maxProviderCalls: FIRST_CALL_LIMIT };
  }
  throw new OpsError('H11_COMMAND_INVALID');
}

function directoryArg(value: string): boolean {
  return !!value && !value.startsWith('-');
}

async function readPreflight(tx: Transaction) {
  assertDirectOpenAITransport();
  // Verify the installed package through E2's version check even with no input.
  prepareMeasuredEmbeddingPlan(createOpenAIEmbeddingProvider(), []);
  const { rows: [space] } = await tx.query<{ status: 'building' | 'active' }>(`
    SELECT status FROM rag.embedding_space
    WHERE space_id=$1 AND provider=$2 AND embedding_model=$3 AND embedding_version=$4
      AND dimension=$5 AND metric=$6 AND vector_type=$7 AND status IN ('building','active')
  `, [SPACE.spaceId, SPACE.provider, SPACE.embeddingModel, SPACE.embeddingVersion,
    SPACE.dimension, SPACE.metric, SPACE.vectorType]);
  if (!space) throw new OpsError('H11_SPACE_CONTRACT_INVALID');

  const { rows: [controls] } = await tx.query<{ compatible: boolean }>(`
    SELECT current_user='rag_app' AND session_user='rag_app'
      AND current_setting('server_version_num')::int / 10000=17
      AND NOT has_column_privilege(current_user,'rag.embedding_space','status','UPDATE')
      AND has_table_privilege(current_user,'rag.chunks_te3s_1536_v1','DELETE')
      AND row_security_active('rag.chunks_te3s_1536_v1')
      AND ${RUNTIME_VECTOR_TYPE_CONTRACT_SQL}
      AND ${RUNTIME_VECTOR_KEY_CONTRACT_SQL}
      AND ${RUNTIME_VECTOR_POLICIES_CONTRACT_SQL}
      AND row_security_active('rag.embedding_attempt')
      AND row_security_active('rag.embedding_reservation')
      AND row_security_active('rag.ingestion_job')
      AND row_security_active('rag.chunk')
      AND has_column_privilege(current_user,'rag.embedding_reservation','batch_plan','INSERT')
      AND has_column_privilege(current_user,'rag.embedding_reservation','exposure_tokens','UPDATE')
      AND has_column_privilege(current_user,'rag.embedding_attempt','input_hash','INSERT')
      AND has_column_privilege(current_user,'rag.embedding_attempt','reported_tokens','UPDATE')
      AND NOT has_column_privilege(current_user,'rag.embedding_attempt','reconciled_tokens','UPDATE')
      AND (SELECT count(*)=4 FROM pg_index
           WHERE indexrelid IN (to_regclass('rag.ingestion_job_one_active'),
             to_regclass('rag.embedding_attempt_active_idx'), to_regclass('rag.embedding_space_one_active'),
             to_regclass('rag.embedding_reservation_period_idx'))
             AND indisvalid AND indisready)
      AND (SELECT count(*)=4 FROM pg_attribute
           WHERE NOT attisdropped AND (
             (attrelid='rag.ingestion_job'::regclass AND attname IN ('observed_at','fence'))
             OR (attrelid='rag.chunk_set'::regclass AND attname='normalized_text' AND NOT attnotnull)
             OR (attrelid='rag.document'::regclass AND attname='purge_pending_at')))
      AND EXISTS (SELECT 1 FROM pg_constraint
          WHERE conrelid='rag.chunk'::regclass AND conname='chunk_byte_count_check'
            AND convalidated AND pg_get_constraintdef(oid) LIKE '%cl100k_base/js-tiktoken@1.0.21%')
    AS compatible`);
  if (!controls?.compatible) throw new OpsError('H11_E2_CONTROLS_INVALID');

  const { rows: [attempts] } = await tx.query<{ ambiguous: boolean; overage: boolean }>(`
    SELECT coalesce(bool_or(state IN ('started','unknown','retryable')),false) AS ambiguous,
           coalesce(bool_or(state='overage'),false) AS overage
    FROM rag.embedding_attempt WHERE reconciled_at IS NULL`);
  const budget = await readEmbeddingBudget(tx);
  const credentialPresent = hasOpenAIEmbeddingCredential();
  const pending = [
    ...(!credentialPresent ? ['PRODUCTION_KEY_PROVISIONING_PENDING'] : []),
    ...(space.status === 'building' ? ['HOSTED_SPACE_ACTIVATION_PENDING'] : []),
  ];
  return {
    provider: OPENAI_EMBEDDING_CONFIG, tokenizer: E2_MEASURED_TOKENIZER, spaceStatus: space.status,
    catalogCompatible: true, durableControlsPresent: true, credentialPresent, pending,
    budget, attempts,
  };
}

async function readOnly<T>(pool: Pool, query: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTransaction(pool, async tx => {
    await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    return query(tx);
  });
}

async function previewSnapshot(
  tx: Transaction,
  input: ReturnType<typeof validateMvpSnapshot>,
  preflight: Awaited<ReturnType<typeof readPreflight>>,
) {
  const catalog = prepareCatalog(input);
  const present = await readProjection(tx, catalog);
  const plan = prepareMeasuredEmbeddingPlan(createOpenAIEmbeddingProvider(),
    catalog.chunks.map(chunk => ({ chunkId: chunk.chunk_id, text: chunk.content })), [...present]);
  const { budget, attempts, pending } = preflight;
  let budgetAvailable = true;
  try {
    quoteH11OfflineReservation(H11_MVP_POLICY, {
      monthlyReservedTokens: Number(budget.monthly_tokens),
      dailyReservedTokens: Number(budget.daily_tokens),
      evaluationMonthlyReservedTokens: Number(budget.evaluation_tokens),
    }, plan, 'ingestion');
  } catch (error) {
    if (!(error instanceof RagEmbeddingError) ||
        !['EMBED_INVALID_INPUT', 'EMBED_BUDGET_EXCEEDED'].includes(error.code)) throw error;
    budgetAvailable = false;
  }
  const publication = await readPublication(tx, catalog.document.document_id);
  const published = publication?.chunkSetId === catalog.set.chunk_set_id;
  const { rows: [state] } = await tx.query<{ deleted: boolean; running: boolean; job_blocked: boolean }>(`
    SELECT EXISTS (SELECT 1 FROM rag.source WHERE source_id=$1 AND deleted_at IS NOT NULL)
        OR EXISTS (SELECT 1 FROM rag.document WHERE document_id=$2 AND deleted_at IS NOT NULL)
        OR EXISTS (SELECT 1 FROM rag.chunk_set WHERE chunk_set_id=$3 AND normalized_text IS NULL) AS deleted,
      EXISTS (SELECT 1 FROM rag.ingestion_job WHERE document_id=$2 AND space_id=$4
        AND kind='ingest' AND status='running' AND lease_expires_at > now()) AS running,
      EXISTS (SELECT 1 FROM rag.ingestion_job WHERE document_id=$2 AND space_id=$4 AND kind='ingest'
        AND rendered_chunk_set_id=$3 AND
        (status IN ('failed','cancelled') OR
         (attempt >= $5 AND status NOT IN ('succeeded','no_op')))) AS job_blocked
  `, [input.source.sourceId, catalog.document.document_id, catalog.set.chunk_set_id, SPACE.spaceId, RAG_LIMITS.MAX_JOB_ATTEMPTS]);
  const blocked = [
    ...(attempts.ambiguous || attempts.overage ? ['EMBED_RECONCILIATION_REQUIRED'] : []),
    ...(!budgetAvailable ? ['EMBED_BUDGET_EXCEEDED'] : []),
    ...(state.deleted ? ['E2_DOCUMENT_DELETED'] : []),
    ...(state.running ? ['H11_JOB_RUNNING'] : []),
    ...(state.job_blocked ? ['E2_JOB_BLOCKED'] : []),
    ...(publication && !published ? ['H11_EXISTING_PUBLICATION'] : []),
  ];
  const firstExecutionEligible = input.source.sourceId === FIRST_SOURCE;
  const operationalCallLimit = firstExecutionEligible ? FIRST_CALL_LIMIT : 0;
  return {
    sourceId: input.source.sourceId,
    documentId: catalog.document.document_id,
    chunkSetId: catalog.set.chunk_set_id,
    profile: 'S512',
    published,
    chunks: catalog.chunks.length,
    measuredTokens: catalog.set.measured_total_tokens,
    missingChunks: catalog.chunks.length - present.size,
    missingTokens: plan.totalTokens,
    initialReservationTokens: plan.worstCaseTokenReservation,
    estimatedInitialMicroUsd: estimateH11EmbeddingCostMicroUsd(plan.totalTokens).toString(),
    estimatedReservationMicroUsd: estimateH11EmbeddingCostMicroUsd(plan.worstCaseTokenReservation).toString(),
    initialBatches: plan.batches.length,
    policyMaxCalls: plan.batches.length ? plan.batches.length + RAG_LIMITS.MAX_JOB_ATTEMPTS - 1 : 0,
    operationalCallLimit,
    firstExecutionEligible,
    admission: blocked.length ? 'blocked' : pending.length ? 'pending'
      : firstExecutionEligible ? 'eligible_for_confirmation' : 'outside_first_execution',
    pending, blocked,
  };
}

/** Used by the CLI and disposable PostgreSQL tests. Every execute invocation reopens the pinned files. */
export async function runH11Operation(pool: Pool, args: readonly string[], signal?: AbortSignal) {
  const command = parseH11Command(args);
  if (command.kind === 'preflight') return readOnly(pool, readPreflight);

  if (command.kind === 'execute' && !hasOpenAIEmbeddingCredential()) {
    throw new RagEmbeddingError('EMBED_CREDENTIAL_UNAVAILABLE');
  }
  const pins = command.kind === 'dry-run' ? MVP_EXPERIMENTAL_CORPUS.snapshots
    : MVP_EXPERIMENTAL_CORPUS.snapshots.filter(pin => pin.sourceId === FIRST_SOURCE);
  const inputs = pins.map(pin => validateMvpSnapshot(command.directory, pin));
  const documents = await readOnly(pool, async tx => {
    const preflight = await readPreflight(tx);
    return Promise.all(inputs.map(input => previewSnapshot(tx, input, preflight)));
  });
  if (command.kind === 'dry-run') return { documents };
  const [first] = documents;
  const firstBatch = !first.published && first.chunks === 25 && first.missingChunks === first.chunks &&
    first.measuredTokens === 5034 && first.missingTokens === first.measuredTokens && first.initialReservationTokens === 20136 &&
    first.initialBatches === command.maxProviderCalls;
  const replay = first.published && first.missingChunks === 0;
  if (first.admission !== 'eligible_for_confirmation' || (!firstBatch && !replay)) {
    throw new OpsError('H11_EXECUTION_PREFLIGHT_BLOCKED');
  }
  return ingestValidatedDocument(pool, createOpenAIEmbeddingProvider({ allowPaidCalls: true }), inputs[0], {
    maxProviderCalls: command.maxProviderCalls, signal,
  });
}

async function main() {
  const args = process.argv.slice(2);
  parseH11Command(args);
  assertDirectOpenAITransport();
  if (process.env.H11_SUPABASE_PROJECT_REF !== SUPABASE_PROJECT_REF ||
      !process.env.SUPABASE_CA_CERT_BASE64) {
    throw new OpsError('H11_HOSTED_TARGET_NOT_CONFIRMED');
  }
  const { pool } = createSupabaseVectorStore();
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.once('SIGINT', abort);
  process.once('SIGTERM', abort);
  try {
    await verifySupabaseRuntimeReadonly(pool);
    const result = await runH11Operation(pool, args, controller.signal);
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } finally {
    process.removeListener('SIGINT', abort);
    process.removeListener('SIGTERM', abort);
    await pool.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    await main();
  } catch (error) {
    const code = error instanceof RagEmbeddingError || error instanceof IngestionError ||
      error instanceof MvpAdmissionError ? error.code : error instanceof OpsError ? error.message : 'H11_OPERATION_FAILED';
    process.stderr.write(code + '\n');
    process.exitCode = 1;
  }
}
