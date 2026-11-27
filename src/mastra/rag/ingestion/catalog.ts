import {
  RUNTIME_VECTOR_KEY_CONTRACT_SQL, RUNTIME_VECTOR_POLICIES_CONTRACT_SQL, RUNTIME_VECTOR_TYPE_CONTRACT_SQL,
} from '../../storage/supabase-runtime-probe.ts';
import { canonicalJson, documentId, sha256 } from '../contracts/ids.ts';
import { RAG_LIMITS, type FetchedDocument, type SourceManifestEntry } from '../contracts/types.ts';
import { assessRenderedPublication, type PublishedRenderedSet } from '../contracts/publication.ts';
import { E2_S512_PROFILE } from '../embeddings/measured-preflight.ts';
import { requireEmbeddingSpace } from '../embeddings/space.ts';
import { DOU_EXTRACTOR_CANDIDATE } from '../processing/dou-html.ts';
import type { NormalizedLegalDocument } from '../processing/legal.ts';
import { renderH9TokenChunksOffline, tokenGridPipelineProfile } from '../processing/token-grid.ts';
import type { Transaction } from './database.ts';
import { IngestionError } from './errors.ts';

export const SPACE = requireEmbeddingSpace('chunks_te3s_1536_v1');

export type ValidatedIngestionInput = Readonly<{
  fetched: FetchedDocument;
  normalized: NormalizedLegalDocument;
  source: Omit<SourceManifestEntry, 'extractor'> & Readonly<{ extractor: typeof DOU_EXTRACTOR_CANDIDATE }>;
}>;

export function prepareCatalog(input: ValidatedIngestionInput) {
  const { source, fetched, normalized } = input;
  if (source.extractor !== DOU_EXTRACTOR_CANDIDATE || source.tenantId !== 'public' ||
      source.sourceId !== fetched.sourceId || source.canonicalUri !== fetched.canonicalUri ||
      documentId('public', source.sourceId, source.canonicalUri) !== fetched.documentId ||
      fetched.charset !== 'utf-8' && fetched.charset !== 'windows-1252' ||
      fetched.byteSize !== fetched.bytes.length || fetched.byteSize > RAG_LIMITS.MAX_RAW_BYTES ||
      sha256(fetched.bytes) !== fetched.contentSha256 ||
      normalized.normalizedText.length > RAG_LIMITS.MAX_NORMALIZED_CHARS ||
      normalized.normalizedText.includes('\0') || Buffer.from(normalized.normalizedText).toString() !== normalized.normalizedText) {
    throw new IngestionError('E2_INPUT_INVALID');
  }
  const set = renderH9TokenChunksOffline(normalized, fetched, source, E2_S512_PROFILE);
  // Validate the observation even when no current pointer exists.
  assessRenderedPublication(null, { chunkSetId: set.chunkSetId, fetchedAt: fetched.fetchedAt });
  if (new Date(fetched.fetchedAt).toISOString() !== fetched.fetchedAt) throw new IngestionError('E2_INPUT_INVALID');

  let blockIndex = 0;
  const chunks = set.chunks.map(chunk => {
    while (normalized.blocks[blockIndex]?.end <= chunk.charStart) blockIndex++;
    return {
      chunk_id: chunk.id,
      chunk_set_id: set.chunkSetId,
      ordinal: chunk.ordinal,
      content: chunk.content,
      content_sha256: sha256(chunk.content),
      byte_count: Buffer.byteLength(chunk.content),
      measured_token_count: chunk.tokenCount,
      measured_tokenizer: set.tokenizer,
      char_start: chunk.charStart,
      char_end: chunk.charEnd,
      heading_path: normalized.blocks[blockIndex]?.headingPath ?? [],
      legal_unit_ids: chunk.legalUnitIds,
    };
  });
  const bytes = chunks.reduce((sum, chunk) => sum + chunk.byte_count, 0);
  if (bytes > 2_000_000) throw new IngestionError('E2_INPUT_INVALID');
  return {
    source: {
      tenant_id: 'public', source_id: source.sourceId, kind: source.kind, canonical_uri: source.canonicalUri,
      license_kind: source.license.kind, license_ref: source.license.reference,
    },
    document: {
      document_id: fetched.documentId, tenant_id: 'public', source_id: source.sourceId,
      canonical_uri: source.canonicalUri, title: source.title,
    },
    version: {
      version_id: set.versionId, document_id: fetched.documentId, content_sha256: fetched.contentSha256,
      final_uri: fetched.finalUri, media_type: fetched.sniffedMediaType, charset: fetched.charset,
      byte_size: fetched.byteSize, fetched_at: fetched.fetchedAt,
    },
    set: {
      chunk_set_id: set.chunkSetId, base_chunk_set_id: set.baseChunkSetId,
      rendering_identity_version: set.identityVersion, version_id: set.versionId,
      document_id: fetched.documentId, pipeline_profile_id: set.profileId,
      pipeline_profile: tokenGridPipelineProfile(source, E2_S512_PROFILE),
      normalized_text: normalized.normalizedText, normalized_sha256: set.normalizedSha256,
      effective_charset: fetched.charset,
      header_metadata_canonical_json: canonicalJson({ sourceTitle: source.title }),
      header_metadata_sha256: set.headerMetadataSha256,
      chunk_count: chunks.length, total_byte_budget: bytes, measured_total_tokens: set.totalTokens,
      measured_tokenizer: set.tokenizer,
    },
    chunks,
  };
}

export type Catalog = ReturnType<typeof prepareCatalog>;
const CATALOG_KEYS = {
  source: ['tenant_id', 'source_id'],
  document: ['document_id'],
  document_version: ['version_id'],
  chunk_set: ['chunk_set_id'],
  chunk: ['chunk_id'],
} as const;

async function insertAndVerify(
  tx: Transaction, table: keyof typeof CATALOG_KEYS,
  records: readonly Record<string, unknown>[], ignored: readonly string[] = [],
): Promise<void> {
  // Identifiers are from the internal catalog mapping above and below.
  const keys = CATALOG_KEYS[table];
  const fields = Object.keys(records[0]).join(', ');
  const payload = JSON.stringify(records);
  await tx.query(`
    INSERT INTO rag.${table} (${fields})
    SELECT ${fields} FROM jsonb_populate_recordset(null::rag.${table}, $1)
    ON CONFLICT (${keys.join(', ')}) DO NOTHING
  `, [payload]);
  const result = await tx.query<{ matches: number }>(`
    SELECT count(*)::int AS matches
    FROM jsonb_populate_recordset(null::rag.${table}, $1) expected
    JOIN rag.${table} actual ON ${keys.map(key => `actual.${key} = expected.${key}`).join(' AND ')}
    WHERE NOT EXISTS (
      SELECT FROM jsonb_each(to_jsonb(expected)) AS field
      WHERE field.key = ANY($3::text[]) AND field.key <> ALL($2::text[])
        AND field.value IS DISTINCT FROM to_jsonb(actual)->field.key
    )
  `, [payload, ignored, Object.keys(records[0])]);
  if (result.rows[0].matches !== records.length) throw new IngestionError('E2_IDENTITY_CONFLICT');
}

export async function assertActiveSpace(tx: Transaction): Promise<void> {
  const result = await tx.query(`
    SELECT 1 FROM rag.embedding_space
    WHERE space_id=$1 AND status='active' AND provider=$2 AND embedding_model=$3
      AND embedding_version=$4 AND dimension=$5 AND metric=$6 AND vector_type=$7
      AND current_user='rag_app' AND session_user='rag_app'
      AND row_security_active('rag.chunks_te3s_1536_v1'::regclass)
      AND ${RUNTIME_VECTOR_TYPE_CONTRACT_SQL}
      AND ${RUNTIME_VECTOR_KEY_CONTRACT_SQL}
      AND ${RUNTIME_VECTOR_POLICIES_CONTRACT_SQL}
  `, [SPACE.spaceId, SPACE.provider, SPACE.embeddingModel, SPACE.embeddingVersion,
    SPACE.dimension, SPACE.metric, SPACE.vectorType]);
  if (!result.rowCount) throw new IngestionError('E2_SPACE_INVALID');
}

export async function assertLive(tx: Transaction, sourceId: string, documentId: string): Promise<void> {
  const result = await tx.query(`
    SELECT 1 FROM rag.source s JOIN rag.document d USING (tenant_id, source_id)
    WHERE s.tenant_id='public' AND s.source_id=$1 AND d.document_id=$2
      AND s.deleted_at IS NULL AND d.deleted_at IS NULL
  `, [sourceId, documentId]);
  if (!result.rowCount) throw new IngestionError('E2_DOCUMENT_DELETED');
}

export async function persistCatalog(tx: Transaction, catalog: Catalog): Promise<void> {
  await insertAndVerify(tx, 'source', [catalog.source]);
  await insertAndVerify(tx, 'document', [catalog.document], ['title']);
  await assertLive(tx, catalog.source.source_id, catalog.document.document_id);
  // The version row retains its first fetch observation. Publication keeps the current watermark.
  await insertAndVerify(tx, 'document_version', [catalog.version], ['fetched_at']);
  const tombstone = await tx.query('SELECT 1 FROM rag.chunk_set WHERE chunk_set_id=$1 AND normalized_text IS NULL',
    [catalog.set.chunk_set_id]);
  if (tombstone.rowCount) throw new IngestionError('E2_PROJECTION_PURGED');
  await insertAndVerify(tx, 'chunk_set', [catalog.set]);
  await insertAndVerify(tx, 'chunk', catalog.chunks);
}

export async function readPublication(tx: Transaction, documentId: string): Promise<PublishedRenderedSet | null> {
  const result = await tx.query<PublishedRenderedSet>(`
    SELECT chunk_set_id AS "chunkSetId",
           to_char(version_fetched_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "versionFetchedAt"
    FROM rag.document_publication WHERE document_id=$1 AND space_id=$2
  `, [documentId, SPACE.spaceId]);
  return result.rows[0] ?? null;
}
