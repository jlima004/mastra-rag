import { canonicalJson } from '../contracts/ids.ts';
import type { Catalog } from './catalog.ts';
import type { Transaction } from './database.ts';
import { IngestionError } from './errors.ts';

// @mastra/pg 1.35 provisions this exact table, unique key and vector type.
// PgVector.upsert allocates its own client. Use its table contract on the
// document transaction's client so a lost lock cannot allow a late write.
function metadata(catalog: Catalog, chunkId: string) {
  return {
    document_id: catalog.document.document_id,
    chunk_set_id: catalog.set.chunk_set_id,
    chunk_id: chunkId,
  };
}

export async function readProjection(tx: Transaction, catalog: Catalog): Promise<Set<string>> {
  const ids = new Set(catalog.chunks.map(chunk => chunk.chunk_id));
  const result = await tx.query<{ vector_id: string; metadata: unknown; dimension: number | null }>(`
    SELECT vector_id, metadata, extensions.vector_dims(embedding) AS dimension
    FROM rag.chunks_te3s_1536_v1
    WHERE namespace='public' AND (metadata->>'chunk_set_id'=$1 OR vector_id=ANY($2::text[]))
  `, [catalog.set.chunk_set_id, [...ids]]);
  const present = new Set<string>();
  for (const row of result.rows) {
    if (!ids.has(row.vector_id) || row.dimension !== 1536 ||
        canonicalJson(row.metadata) !== canonicalJson(metadata(catalog, row.vector_id))) {
      throw new IngestionError('E2_BUILD_INVALID');
    }
    present.add(row.vector_id);
  }
  return present;
}

export async function upsertProjection(
  tx: Transaction, catalog: Catalog, chunks: readonly {chunkId: string}[], vectors: readonly number[][],
): Promise<void> {
  const rows = chunks.map(({chunkId}, index) => ({
    vector_id: chunkId,
    embedding: JSON.stringify(vectors[index]),
    metadata: metadata(catalog, chunkId),
  }));
  await tx.query(`
    INSERT INTO rag.chunks_te3s_1536_v1 (vector_id, embedding, metadata, namespace)
    SELECT v.vector_id, v.embedding::extensions.vector(1536), v.metadata, 'public'
    FROM jsonb_to_recordset($1) AS v(vector_id text, embedding text, metadata jsonb)
    ON CONFLICT (namespace, vector_id) DO UPDATE
      SET embedding=EXCLUDED.embedding, metadata=EXCLUDED.metadata
  `, [JSON.stringify(rows)]);
}

export async function verifyProjection(tx: Transaction, catalog: Catalog): Promise<void> {
  const result = await tx.query<{ chunk_id: string }>(
    'SELECT chunk_id FROM rag.chunk WHERE chunk_set_id=$1 ORDER BY ordinal', [catalog.set.chunk_set_id]);
  if (result.rows.length !== catalog.chunks.length ||
      result.rows.some((chunk, index) => chunk.chunk_id !== catalog.chunks[index].chunk_id) ||
      (await readProjection(tx, catalog)).size !== catalog.chunks.length) {
    throw new IngestionError('E2_BUILD_INVALID');
  }
}
