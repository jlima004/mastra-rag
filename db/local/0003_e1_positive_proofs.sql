-- Real DDL/RLS proof in disposable pgvector/pgvector:pg17 only.
-- Invoked by scripts/test-e1-local.sh against fixed local container.
DO $$
BEGIN
  IF has_schema_privilege('anon','rag','USAGE') OR
     has_schema_privilege('authenticated','rag','USAGE') OR
     has_schema_privilege('rag_app','rag','CREATE') THEN
    RAISE EXCEPTION 'E1_PRIVILEGE_BOUNDARY_FAILED';
  END IF;
  IF (SELECT rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole
      FROM pg_roles WHERE rolname='rag_app') THEN
    RAISE EXCEPTION 'E1_RUNTIME_ROLE_TOO_PRIVILEGED';
  END IF;
  IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='rag' AND c.relkind='r' AND NOT c.relrowsecurity) <> 0 THEN
    RAISE EXCEPTION 'E1_RLS_NOT_ENABLED';
  END IF;
END;
$$;

INSERT INTO rag.embedding_space
  (space_id,provider,embedding_model,embedding_version,dimension,metric,vector_type)
VALUES ('chunks_te3s_1536_v1','openai','text-embedding-3-small',1,1536,'cosine','vector');

SET ROLE rag_app;
DO $
BEGIN
  IF NOT row_security_active('rag.source'::regclass) OR
     NOT row_security_active('rag.chunks_te3s_1536_v1'::regclass) THEN
    RAISE EXCEPTION 'E1_RLS_NOT_ACTIVE_FOR_APP';
  END IF;
END;
$;

INSERT INTO rag.source (source_id,kind,canonical_uri,license_kind,license_ref)
VALUES ('synthetic-lgpd','http','https://example.test/fixture','official-act-br','synthetic');
INSERT INTO rag.document (document_id,source_id,canonical_uri,title)
VALUES (repeat('a',64),'synthetic-lgpd','https://example.test/fixture','Synthetic');
INSERT INTO rag.document_version
  (version_id,document_id,content_sha256,final_uri,media_type,charset,byte_size,fetched_at)
VALUES (repeat('b',64),repeat('a',64),repeat('c',64),
  'https://example.test/fixture','text/html','utf-8',100,'2026-11-17T12:00:00Z');

-- Same (version, profile), DIFFERENT rendering metadata: both must persist.
INSERT INTO rag.chunk_set
  (chunk_set_id,base_chunk_set_id,rendering_identity_version,version_id,document_id,
   pipeline_profile_id,pipeline_profile,normalized_text,normalized_sha256,
   effective_charset,header_metadata_canonical_json,header_metadata_sha256,chunk_count,total_byte_budget)
VALUES
  (repeat('d',64),repeat('e',64),'rag:chunkset-rendered:v2',
   repeat('b',64),repeat('a',64),repeat('f',64),'{}'::jsonb,'synthetic',repeat('1',64),
   'utf-8','{"sourceTitle":"Synthetic"}',repeat('2',64),1,80),
  (repeat('6',64),repeat('e',64),'rag:chunkset-rendered:v2',
   repeat('b',64),repeat('a',64),repeat('f',64),'{}'::jsonb,'synthetic',repeat('1',64),
   'windows-1252','{"sourceTitle":"Renamed"}',repeat('3',64),1,80);

DO $$
BEGIN
  IF (SELECT count(*) FROM rag.chunk_set
      WHERE version_id=repeat('b',64) AND pipeline_profile_id=repeat('f',64)) <> 2 THEN
    RAISE EXCEPTION 'E1_RENDER_ID_COLLISION';
  END IF;
END;
$$;

INSERT INTO rag.index_build(chunk_set_id,space_id,status)
VALUES (repeat('d',64),'chunks_te3s_1536_v1','verified');
INSERT INTO rag.document_publication
  (document_id,space_id,chunk_set_id,version_fetched_at)
VALUES (repeat('a',64),'chunks_te3s_1536_v1',repeat('d',64),'2026-11-17T12:00:00Z');

INSERT INTO rag.ingestion_job
  (idempotency_key,idempotency_version,kind,source_id,document_id,space_id,rendered_chunk_set_id)
VALUES
  (repeat('8',64),2,'ingest','synthetic-lgpd',repeat('a',64),'chunks_te3s_1536_v1',repeat('d',64)),
  (repeat('9',64),2,'ingest','synthetic-lgpd',repeat('a',64),'chunks_te3s_1536_v1',repeat('6',64));

-- Real PgVector ON CONFLICT requires SELECT/UPDATE permissions + policies.
INSERT INTO rag.chunks_te3s_1536_v1 (vector_id,embedding,metadata,namespace)
VALUES ('synthetic-vector-1',
  ('[' || repeat('0.01,',1535) || '0.01]')::extensions.vector(1536),
  '{"revision":1}'::jsonb,'public');
INSERT INTO rag.chunks_te3s_1536_v1 (vector_id,embedding,metadata,namespace)
VALUES ('synthetic-vector-1',
  ('[' || repeat('0.01,',1535) || '0.01]')::extensions.vector(1536),
  '{"revision":2}'::jsonb,'public')
ON CONFLICT (namespace,vector_id)
DO UPDATE SET metadata=EXCLUDED.metadata;

DO $$
BEGIN
  IF (SELECT count(*) FROM rag.chunks_te3s_1536_v1
       WHERE namespace='public' AND metadata->>'revision'='2') <> 1 THEN
    RAISE EXCEPTION 'E1_PGVECTOR_UPSERT_FAILED';
  END IF;
END;
$$;
RESET ROLE;

-- Insert a different namespace with the owner role; rag_app must not see it.
INSERT INTO rag.chunks_te3s_1536_v1 (vector_id,embedding,metadata,namespace)
VALUES ('synthetic-other-tenant',
  ('[' || repeat('0.01,',1535) || '0.01]')::extensions.vector(1536),
  '{}'::jsonb,'other');
SET ROLE rag_app;
DO $$
BEGIN
  IF (SELECT count(*) FROM rag.chunks_te3s_1536_v1 WHERE namespace='other') <> 0 THEN
    RAISE EXCEPTION 'E1_NAMESPACE_LEAK';
  END IF;
END;
$$;
RESET ROLE;
