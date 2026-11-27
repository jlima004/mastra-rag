-- Separate administrative authorization required. Use the runbook's direct
-- TLS-verified connection. This file is outside the migration directory.
\set ON_ERROR_STOP on
\getenv tls_mode PGSSLMODE
BEGIN;
-- A wrong client target fails the transaction before any lock or write.
SELECT 1 / CASE WHEN :'HOST' = 'db.lmocjhpajhxegzobydau.supabase.co'
    AND :'PORT' = '5432' AND :'tls_mode' = 'verify-full'
  THEN 1 ELSE 0 END AS approved_client_target;
LOCK TABLE rag.embedding_space IN SHARE ROW EXCLUSIVE MODE;
DO $$
DECLARE
  updated integer;
BEGIN
  IF current_database() <> 'postgres' OR session_user <> 'postgres' OR current_user <> 'postgres'
      OR current_setting('server_version_num')::int / 10000 <> 17
      OR NOT EXISTS (SELECT 1 FROM pg_stat_ssl WHERE pid=pg_backend_pid() AND ssl)
      OR NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20261127135647')
      OR has_column_privilege('rag_app','rag.embedding_space','status','UPDATE') THEN
    RAISE EXCEPTION 'H11_ACTIVATION_TARGET_OR_E2_INVALID';
  END IF;

  IF EXISTS (SELECT 1 FROM rag.embedding_space WHERE status='active')
      OR NOT EXISTS (SELECT 1 FROM pg_index
        WHERE indexrelid='rag.embedding_space_one_active'::regclass AND indisunique AND indisvalid)
      OR NOT EXISTS (SELECT 1 FROM pg_class
        WHERE oid='rag.chunks_te3s_1536_v1'::regclass AND relkind='r' AND relrowsecurity
          AND pg_get_userbyid(relowner)='postgres')
      OR NOT EXISTS (SELECT 1 FROM pg_attribute
        WHERE attrelid='rag.chunks_te3s_1536_v1'::regclass AND attname='embedding' AND NOT attisdropped
          AND atttypid='extensions.vector'::regtype AND atttypmod=1536)
      OR NOT EXISTS (SELECT 1 FROM pg_index
        WHERE indexrelid='rag.chunks_te3s_1536_v1_namespace_vector_id_idx'::regclass
          AND indrelid='rag.chunks_te3s_1536_v1'::regclass AND indisunique AND indisvalid
          AND indisready AND indpred IS NULL AND indnkeyatts=2
          AND pg_get_indexdef(indexrelid) LIKE '%(namespace, vector_id)%')
      OR NOT (SELECT count(*)=4 AND coalesce(bool_and(roles=ARRAY['rag_app']::name[]
                 AND permissive='PERMISSIVE' AND (
            (policyname='rag_vector_select' AND cmd='SELECT'
              AND qual='((namespace)::text = ''public''::text)' AND with_check IS NULL)
            OR (policyname='rag_vector_insert' AND cmd='INSERT'
              AND qual IS NULL AND with_check='((namespace)::text = ''public''::text)')
            OR (policyname='rag_vector_update' AND cmd='UPDATE'
              AND qual='((namespace)::text = ''public''::text)' AND with_check='((namespace)::text = ''public''::text)')
            OR (policyname='rag_vector_delete' AND cmd='DELETE'
              AND qual='((namespace)::text = ''public''::text)' AND with_check IS NULL)
          )),false)
        FROM pg_policies WHERE schemaname='rag' AND tablename='chunks_te3s_1536_v1')
      OR NOT has_table_privilege('rag_app','rag.chunks_te3s_1536_v1','DELETE')
      OR NOT EXISTS (SELECT 1 FROM pg_class WHERE oid='rag.embedding_reservation'::regclass AND relrowsecurity)
      OR NOT EXISTS (SELECT 1 FROM pg_class WHERE oid='rag.embedding_attempt'::regclass AND relrowsecurity)
      OR NOT EXISTS (SELECT 1 FROM pg_index
        WHERE indexrelid='rag.embedding_attempt_active_idx'::regclass AND indisunique AND indisvalid) THEN
    RAISE EXCEPTION 'H11_ACTIVATION_PROJECTION_OR_LEDGER_INVALID';
  END IF;

  UPDATE rag.embedding_space SET status='active'
  WHERE space_id='chunks_te3s_1536_v1' AND status='building'
    AND provider='openai' AND embedding_model='text-embedding-3-small'
    AND embedding_version=1 AND dimension=1536 AND metric='cosine' AND vector_type='vector';
  GET DIAGNOSTICS updated = ROW_COUNT;
  IF updated <> 1 THEN
    RAISE EXCEPTION 'H11_ACTIVATION_EXPECTED_ONE_ROW';
  END IF;
END
$$;
COMMIT;

SELECT space_id, provider, embedding_model, embedding_version, dimension, metric, vector_type, status
FROM rag.embedding_space WHERE status='active';
