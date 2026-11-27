/**
 * E1 runtime gate: authenticated rag_app and read-only catalog verification.
 * This query never inserts, updates, creates, or exposes private content.
 * A positive result is NOT permission to ingest, run embeddings, or publish a space.
 */
export const RAG_VECTOR_SPACE_ID = 'chunks_te3s_1536_v1' as const;
export const RAG_VECTOR_NAMESPACE = 'public' as const;

/**
 * PgVector physical type identity is an OID; format_type(...) depends on
 * session search_path. The pinned pgvector extension lives in "extensions".
 */
export const RUNTIME_VECTOR_TYPE_CONTRACT_SQL = `EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute a
    WHERE a.attrelid='rag.chunks_te3s_1536_v1'::regclass
      AND a.attname='embedding' AND NOT a.attisdropped
      AND a.atttypid='extensions.vector'::regtype AND a.atttypmod=1536
  )`;

export const RUNTIME_VECTOR_KEY_CONTRACT_SQL = `EXISTS (SELECT 1 FROM pg_index x JOIN pg_class idx ON idx.oid=x.indexrelid
    WHERE x.indrelid='rag.chunks_te3s_1536_v1'::regclass
      AND idx.relname='chunks_te3s_1536_v1_namespace_vector_id_idx'
      AND x.indisunique AND x.indisvalid AND x.indisready AND x.indpred IS NULL
      AND x.indnkeyatts=2 AND pg_get_indexdef(x.indexrelid) LIKE '%(namespace, vector_id)%')`;

/**
 * Match full predicates for E1 and the scoped E2 DELETE permission.
 * The E2 policy is required only when the durable ledger exists. An extra
 * policy, an unexpected role or a changed namespace predicate fails closed.
 */
export const RUNTIME_VECTOR_POLICIES_CONTRACT_SQL = `(
    SELECT count(*) FILTER (WHERE policyname <> 'rag_vector_delete') = 3
      AND count(*) FILTER (
      WHERE roles=ARRAY['rag_app']::name[]
        AND (
          (policyname='rag_vector_select' AND cmd='SELECT'
            AND qual='((namespace)::text = ''public''::text)' AND with_check IS NULL)
          OR (policyname='rag_vector_insert' AND cmd='INSERT'
            AND qual IS NULL AND with_check='((namespace)::text = ''public''::text)')
          OR (policyname='rag_vector_update' AND cmd='UPDATE'
            AND qual='((namespace)::text = ''public''::text)' AND with_check='((namespace)::text = ''public''::text)')
        )
    )=3
      AND CASE WHEN to_regclass('rag.embedding_reservation') IS NULL
        THEN count(*) FILTER (WHERE policyname = 'rag_vector_delete') = 0
        ELSE count(*) FILTER (
          WHERE policyname = 'rag_vector_delete' AND cmd = 'DELETE'
            AND roles = ARRAY['rag_app']::name[] AND with_check IS NULL
            AND qual = '((namespace)::text = ''public''::text)'
        ) = 1
      END
    FROM pg_catalog.pg_policies
    WHERE schemaname='rag' AND tablename='chunks_te3s_1536_v1'
  )`;

export const RUNTIME_READONLY_PROBE_SQL = `SELECT (
  current_user = 'rag_app'
  AND session_user = 'rag_app'
  AND current_database() = 'postgres'
  AND EXISTS (SELECT 1 FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='vector' AND n.nspname='extensions')
  AND has_schema_privilege(current_user,'rag','USAGE')
  AND NOT has_schema_privilege(current_user,'rag','CREATE')
  AND has_schema_privilege(current_user,'extensions','USAGE')
  AND NOT has_schema_privilege(current_user,'extensions','CREATE')
  AND NOT has_schema_privilege(current_user,'public','CREATE')
  AND NOT has_schema_privilege('anon','rag','USAGE')
  AND NOT has_schema_privilege('authenticated','rag','USAGE')
  AND NOT has_schema_privilege('service_role','rag','USAGE')
  AND EXISTS (SELECT 1 FROM pg_roles
    WHERE rolname='rag_app' AND rolcanlogin AND NOT rolinherit AND NOT rolsuper
      AND NOT rolbypassrls AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication)
  AND NOT EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member WHERE r.rolname='rag_app')
  AND EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='rag' AND c.relname='chunks_te3s_1536_v1' AND c.relkind='r'
      AND c.relrowsecurity AND pg_get_userbyid(c.relowner)='postgres')
  AND row_security_active('rag.chunks_te3s_1536_v1'::regclass)
  AND ${RUNTIME_VECTOR_TYPE_CONTRACT_SQL}
  AND ${RUNTIME_VECTOR_KEY_CONTRACT_SQL}
  AND ${RUNTIME_VECTOR_POLICIES_CONTRACT_SQL}
  AND has_table_privilege(current_user,'rag.chunks_te3s_1536_v1','SELECT')
  AND has_table_privilege(current_user,'rag.chunks_te3s_1536_v1','INSERT')
  AND has_table_privilege(current_user,'rag.chunks_te3s_1536_v1','UPDATE')
  AND has_table_privilege(current_user,'rag.chunks_te3s_1536_v1','DELETE')
    = (to_regclass('rag.embedding_reservation') IS NOT NULL)
  AND NOT has_table_privilege(current_user,'rag.chunks_te3s_1536_v1','TRUNCATE')
  AND has_sequence_privilege(current_user,'rag.chunks_te3s_1536_v1_id_seq','USAGE')
  AND has_table_privilege(current_user,'rag.embedding_space','SELECT')
  AND NOT has_table_privilege(current_user,'rag.embedding_space','INSERT')
  AND EXISTS (SELECT 1 FROM rag.embedding_space
    WHERE space_id='chunks_te3s_1536_v1' AND provider='openai'
      AND embedding_model='text-embedding-3-small' AND embedding_version=1
      AND dimension=1536 AND metric='cosine' AND vector_type='vector'
      AND status IN ('building','active'))
) AS runtime_ready`;

type ProbeRow = { runtime_ready: boolean };
type ReadonlyPool = { query(sql: string): Promise<{ rows: ProbeRow[] }> };

export async function verifySupabaseRuntimeReadonly(pool: ReadonlyPool): Promise<void> {
  const result = await pool.query(RUNTIME_READONLY_PROBE_SQL);
  if (result.rows.length !== 1 || result.rows[0]?.runtime_ready !== true) {
    throw new Error('Supabase runtime role, vector schema or RLS contract is unavailable.');
  }
}
