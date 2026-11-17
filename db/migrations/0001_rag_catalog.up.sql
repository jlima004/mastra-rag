-- RAG-E1: LOCAL/REVIEW-ONLY catalog candidate. NEVER applied by CI to hosted Supabase.
-- Prerequisites: private schema rag (existing production foundation migration
-- 20261113233720), role rag_app created by separate OWNER-reviewed step.
-- This file deliberately contains no extension/role creation, no live ingestion.
BEGIN;

CREATE TABLE rag.embedding_space (
  space_id text PRIMARY KEY CHECK (space_id ~ '^chunks_[a-z0-9_]{1,33}$'),
  provider text NOT NULL,
  embedding_model text NOT NULL,
  embedding_version integer NOT NULL CHECK (embedding_version >= 1),
  dimension integer NOT NULL CHECK (dimension BETWEEN 1 AND 2000),
  metric text NOT NULL CHECK (metric = 'cosine'),
  vector_type text NOT NULL CHECK (vector_type = 'vector'),
  status text NOT NULL DEFAULT 'building'
    CHECK (status IN ('building','active','retiring','retired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, embedding_model, embedding_version, dimension, metric, vector_type)
);
CREATE UNIQUE INDEX embedding_space_one_active ON rag.embedding_space ((true))
  WHERE status = 'active';

CREATE TABLE rag.source (
  tenant_id text NOT NULL DEFAULT 'public' CHECK (tenant_id = 'public'),
  source_id text NOT NULL CHECK (source_id ~ '^[a-z0-9][a-z0-9-]{2,79}$'),
  kind text NOT NULL CHECK (kind = 'http'),
  canonical_uri text NOT NULL,
  license_kind text NOT NULL,
  license_ref text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  PRIMARY KEY (tenant_id,source_id)
);

CREATE TABLE rag.document (
  document_id text PRIMARY KEY CHECK (document_id ~ '^[0-9a-f]{64}$'),
  tenant_id text NOT NULL DEFAULT 'public' CHECK (tenant_id = 'public'),
  source_id text NOT NULL,
  canonical_uri text NOT NULL,
  title text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  FOREIGN KEY (tenant_id, source_id) REFERENCES rag.source (tenant_id, source_id),
  UNIQUE (tenant_id, source_id, canonical_uri)
);

CREATE TABLE rag.document_version (
  version_id text PRIMARY KEY CHECK (version_id ~ '^[0-9a-f]{64}$'),
  document_id text NOT NULL REFERENCES rag.document (document_id) ON DELETE CASCADE,
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  final_uri text NOT NULL,
  media_type text NOT NULL,
  charset text NOT NULL,
  byte_size integer NOT NULL CHECK (byte_size BETWEEN 1 AND 5242880),
  fetched_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, content_sha256),
  UNIQUE (document_id, version_id)
);

-- Authoritative identity is Step C *rendered* v2, not the Step B base ID.
-- Different decoded outputs and structure-aware title headers can share
-- (version_id, pipeline_profile_id) while legitimately differing in rendering.
CREATE TABLE rag.chunk_set (
  chunk_set_id text PRIMARY KEY CHECK (chunk_set_id ~ '^[0-9a-f]{64}$'),
  base_chunk_set_id text NOT NULL CHECK (base_chunk_set_id ~ '^[0-9a-f]{64}$'),
  rendering_identity_version text NOT NULL
    CHECK (rendering_identity_version = 'rag:chunkset-rendered:v2'),
  version_id text NOT NULL,
  document_id text NOT NULL,
  pipeline_profile_id text NOT NULL CHECK (pipeline_profile_id ~ '^[0-9a-f]{64}$'),
  pipeline_profile jsonb NOT NULL,
  normalized_text text NOT NULL CHECK (length(normalized_text) <= 1000000),
  normalized_sha256 text NOT NULL CHECK (normalized_sha256 ~ '^[0-9a-f]{64}$'),
  -- The same raw version can be decoded with different effective charsets.
  effective_charset text NOT NULL CHECK (effective_charset IN ('utf-8','windows-1252')),
  -- Persist the exact canonical hash input used in the structural header.
  header_metadata_canonical_json text,
  header_metadata_sha256 text CHECK (
    header_metadata_sha256 IS NULL OR header_metadata_sha256 ~ '^[0-9a-f]{64}$'),
  chunk_count integer NOT NULL CHECK (chunk_count BETWEEN 1 AND 2000),
  -- Step C byte proxy is NOT verified model tokens. Keep measured counts NULL
  -- until H9/H11 authorization and a calibrated tokenizer in later stages.
  total_byte_budget integer NOT NULL CHECK (total_byte_budget > 0 AND total_byte_budget <= 2000000),
  measured_total_tokens integer CHECK (measured_total_tokens BETWEEN 1 AND 2000000),
  measured_tokenizer text,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (document_id, version_id) REFERENCES rag.document_version (document_id, version_id)
    ON DELETE CASCADE,
  UNIQUE (document_id, chunk_set_id),
  CHECK ((measured_total_tokens IS NULL) = (measured_tokenizer IS NULL)),
  CHECK ((header_metadata_canonical_json IS NULL) = (header_metadata_sha256 IS NULL))
);

CREATE TABLE rag.chunk (
  chunk_id text PRIMARY KEY CHECK (chunk_id ~ '^[0-9a-f]{64}$'),
  chunk_set_id text NOT NULL REFERENCES rag.chunk_set (chunk_set_id) ON DELETE CASCADE,
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  content text NOT NULL,
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  byte_count integer NOT NULL CHECK (byte_count BETWEEN 1 AND 1024),
  measured_token_count integer CHECK (measured_token_count BETWEEN 1 AND 1024),
  measured_tokenizer text,
  char_start integer NOT NULL CHECK (char_start >= 0),
  char_end integer NOT NULL CHECK (char_end > char_start),
  heading_path text[] NOT NULL,
  legal_unit_ids text[] NOT NULL CHECK (cardinality(legal_unit_ids) >= 1),
  UNIQUE (chunk_set_id, ordinal),
  CHECK ((measured_token_count IS NULL) = (measured_tokenizer IS NULL))
);

CREATE TABLE rag.index_build (
  chunk_set_id text NOT NULL REFERENCES rag.chunk_set (chunk_set_id) ON DELETE CASCADE,
  space_id text NOT NULL REFERENCES rag.embedding_space (space_id),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','embedding','verified','published','superseded','failed','purged')),
  embedded_count integer NOT NULL DEFAULT 0 CHECK (embedded_count >= 0),
  tokens_billed integer NOT NULL DEFAULT 0 CHECK (tokens_billed >= 0),
  error_code text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chunk_set_id, space_id)
);

CREATE TABLE rag.document_publication (
  document_id text NOT NULL REFERENCES rag.document (document_id) ON DELETE CASCADE,
  space_id text NOT NULL REFERENCES rag.embedding_space (space_id),
  chunk_set_id text NOT NULL,
  previous_chunk_set_id text,
  version_fetched_at timestamptz NOT NULL,
  published_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (document_id, space_id),
  FOREIGN KEY (document_id, chunk_set_id)
    REFERENCES rag.chunk_set (document_id, chunk_set_id),
  FOREIGN KEY (chunk_set_id, space_id)
    REFERENCES rag.index_build (chunk_set_id, space_id),
  FOREIGN KEY (document_id, previous_chunk_set_id)
    REFERENCES rag.chunk_set (document_id, chunk_set_id),
  FOREIGN KEY (previous_chunk_set_id, space_id)
    REFERENCES rag.index_build (chunk_set_id, space_id)
);

CREATE TABLE rag.ingestion_job (
  job_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL CHECK (idempotency_key ~ '^[0-9a-f]{64}$'),
  -- ingest jobs use rag:job:v2 (after deterministic rendering, before embedding).
  idempotency_version integer NOT NULL DEFAULT 1 CHECK (idempotency_version IN (1,2)),
  kind text NOT NULL CHECK (kind IN ('ingest','reindex','delete','gc')),
  tenant_id text NOT NULL DEFAULT 'public' CHECK (tenant_id = 'public'),
  source_id text,
  document_id text REFERENCES rag.document (document_id),
  space_id text REFERENCES rag.embedding_space (space_id),
  rendered_chunk_set_id text REFERENCES rag.chunk_set (chunk_set_id),
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','running','succeeded','no_op','failed','cancelled')),
  stage text,
  attempt integer NOT NULL DEFAULT 0 CHECK (attempt BETWEEN 0 AND 4),
  lease_owner text,
  lease_expires_at timestamptz,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'running') = (lease_owner IS NOT NULL)),
  CHECK (kind <> 'ingest' OR (
    idempotency_version = 2 AND source_id IS NOT NULL AND space_id IS NOT NULL
    AND document_id IS NOT NULL AND rendered_chunk_set_id IS NOT NULL)),
  UNIQUE (idempotency_key)
);

CREATE INDEX document_live_idx ON rag.document (tenant_id,source_id)
  WHERE deleted_at IS NULL;
CREATE INDEX chunk_set_version_idx ON rag.chunk_set (version_id);
CREATE INDEX index_build_status_idx ON rag.index_build (space_id,status);
CREATE INDEX publication_space_idx ON rag.document_publication (space_id,chunk_set_id);
CREATE INDEX ingestion_job_claim_idx ON rag.ingestion_job (status, lease_expires_at)
  WHERE status IN ('queued','running');

-- Defense in depth; runtime role must never own these tables and cannot bypass RLS.
-- Single public tenant MVP only. All future multi-tenant work requires new policies.
ALTER TABLE rag.embedding_space ENABLE ROW LEVEL SECURITY;
ALTER TABLE rag.source ENABLE ROW LEVEL SECURITY;
ALTER TABLE rag.document ENABLE ROW LEVEL SECURITY;
ALTER TABLE rag.document_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE rag.chunk_set ENABLE ROW LEVEL SECURITY;
ALTER TABLE rag.chunk ENABLE ROW LEVEL SECURITY;
ALTER TABLE rag.index_build ENABLE ROW LEVEL SECURITY;
ALTER TABLE rag.document_publication ENABLE ROW LEVEL SECURITY;
ALTER TABLE rag.ingestion_job ENABLE ROW LEVEL SECURITY;

CREATE POLICY rag_app_space ON rag.embedding_space FOR ALL TO rag_app USING (true) WITH CHECK (true);
CREATE POLICY rag_app_source ON rag.source FOR ALL TO rag_app
  USING (tenant_id = 'public') WITH CHECK (tenant_id = 'public');
CREATE POLICY rag_app_document ON rag.document FOR ALL TO rag_app
  USING (tenant_id = 'public') WITH CHECK (tenant_id = 'public');
CREATE POLICY rag_app_version ON rag.document_version FOR ALL TO rag_app USING (true) WITH CHECK (true);
CREATE POLICY rag_app_set ON rag.chunk_set FOR ALL TO rag_app USING (true) WITH CHECK (true);
CREATE POLICY rag_app_chunk ON rag.chunk FOR ALL TO rag_app USING (true) WITH CHECK (true);
CREATE POLICY rag_app_build ON rag.index_build FOR ALL TO rag_app USING (true) WITH CHECK (true);
CREATE POLICY rag_app_publication ON rag.document_publication FOR ALL TO rag_app USING (true) WITH CHECK (true);
CREATE POLICY rag_app_job ON rag.ingestion_job FOR ALL TO rag_app
  USING (tenant_id = 'public') WITH CHECK (tenant_id = 'public');

GRANT USAGE ON SCHEMA rag TO rag_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  rag.embedding_space, rag.source, rag.document, rag.document_version,
  rag.chunk_set, rag.chunk, rag.index_build, rag.document_publication,
  rag.ingestion_job TO rag_app;
-- Namespace enforcement in PgVector space tables is added separately by the
-- operator AFTER privileged createIndex, never by app bootstrap.
COMMIT;
),
  -- The same raw version can be decoded with a different effective charset.
  effective_charset text NOT NULL CHECK (effective_charset IN ('utf-8','windows-1252')),
  -- Exact canonical hash input is snapshotted with each rendered chunk set.
  header_metadata_canonical_json text,
  header_metadata_sha256 text CHECK (
    header_metadata_sha256 IS NULL OR header_metadata_sha256 ~ '^[0-9a-f]{64}$'),
  chunk_count integer NOT NULL CHECK (chunk_count BETWEEN 1 AND 2000),
  -- Step C byte proxy is NOT verified model tokens. Keep measured counts NULL
  -- until H9/H11 authorization and a calibrated tokenizer in later stages.
  total_byte_budget integer NOT NULL CHECK (total_byte_budget > 0 AND total_byte_budget <= 2000000),
  measured_total_tokens integer CHECK (measured_total_tokens BETWEEN 1 AND 2000000),
  measured_tokenizer text,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (document_id, version_id) REFERENCES rag.document_version (document_id, version_id)
    ON DELETE CASCADE,
  UNIQUE (document_id, chunk_set_id),
  CHECK ((measured_total_tokens IS NULL) = (measured_tokenizer IS NULL))
);

CREATE TABLE rag.chunk (
  chunk_id text PRIMARY KEY CHECK (chunk_id ~ '^[0-9a-f]{64}$'),
  chunk_set_id text NOT NULL REFERENCES rag.chunk_set (chunk_set_id) ON DELETE CASCADE,
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  content text NOT NULL,
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  byte_count integer NOT NULL CHECK (byte_count BETWEEN 1 AND 1024),
  measured_token_count integer CHECK (measured_token_count BETWEEN 1 AND 1024),
  measured_tokenizer text,
  char_start integer NOT NULL CHECK (char_start >= 0),
  char_end integer NOT NULL CHECK (char_end > char_start),
  heading_path text[] NOT NULL,
  legal_unit_ids text[] NOT NULL CHECK (cardinality(legal_unit_ids) >= 1),
  UNIQUE (chunk_set_id, ordinal),
  CHECK ((measured_token_count IS NULL) = (measured_tokenizer IS NULL))
);

CREATE TABLE rag.index_build (
  chunk_set_id text NOT NULL REFERENCES rag.chunk_set (chunk_set_id) ON DELETE CASCADE,
  space_id text NOT NULL REFERENCES rag.embedding_space (space_id),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','embedding','verified','published','superseded','failed','purged')),
  embedded_count integer NOT NULL DEFAULT 0 CHECK (embedded_count >= 0),
  tokens_billed integer NOT NULL DEFAULT 0 CHECK (tokens_billed >= 0),
  error_code text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chunk_set_id, space_id)
);

CREATE TABLE rag.document_publication (
  document_id text NOT NULL REFERENCES rag.document (document_id) ON DELETE CASCADE,
  space_id text NOT NULL REFERENCES rag.embedding_space (space_id),
  chunk_set_id text NOT NULL,
  previous_chunk_set_id text,
  version_fetched_at timestamptz NOT NULL,
  published_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (document_id, space_id),
  FOREIGN KEY (document_id, chunk_set_id)
    REFERENCES rag.chunk_set (document_id, chunk_set_id),
  FOREIGN KEY (chunk_set_id, space_id)
    REFERENCES rag.index_build (chunk_set_id, space_id),
  FOREIGN KEY (document_id, previous_chunk_set_id)
    REFERENCES rag.chunk_set (document_id, chunk_set_id),
  FOREIGN KEY (previous_chunk_set_id, space_id)
    REFERENCES rag.index_build (chunk_set_id, space_id)
);

CREATE TABLE rag.ingestion_job (
  job_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL CHECK (idempotency_key ~ '^[0-9a-f]{64}$'),
  -- ingest jobs use rag:job:v2 (after deterministic rendering, before embedding).
  idempotency_version integer NOT NULL DEFAULT 1 CHECK (idempotency_version IN (1,2)),
  kind text NOT NULL CHECK (kind IN ('ingest','reindex','delete','gc')),
  tenant_id text NOT NULL DEFAULT 'public' CHECK (tenant_id = 'public'),
  source_id text,
  document_id text REFERENCES rag.document (document_id),
  space_id text REFERENCES rag.embedding_space (space_id),
  rendered_chunk_set_id text REFERENCES rag.chunk_set (chunk_set_id),
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','running','succeeded','no_op','failed','cancelled')),
  stage text,
  attempt integer NOT NULL DEFAULT 0 CHECK (attempt BETWEEN 0 AND 4),
  lease_owner text,
  lease_expires_at timestamptz,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'running') = (lease_owner IS NOT NULL)),
  CHECK (kind <> 'ingest' OR (
    idempotency_version = 2 AND source_id IS NOT NULL AND space_id IS NOT NULL
    AND document_id IS NOT NULL AND rendered_chunk_set_id IS NOT NULL)),
  UNIQUE (idempotency_key)
);

CREATE INDEX document_live_idx ON rag.document (tenant_id,source_id)
  WHERE deleted_at IS NULL;
CREATE INDEX chunk_set_version_idx ON rag.chunk_set (version_id);
CREATE INDEX index_build_status_idx ON rag.index_build (space_id,status);
CREATE INDEX publication_space_idx ON rag.document_publication (space_id,chunk_set_id);
CREATE INDEX ingestion_job_claim_idx ON rag.ingestion_job (status, lease_expires_at)
  WHERE status IN ('queued','running');

-- Defense in depth; runtime role must never own these tables and cannot bypass RLS.
-- Single public tenant MVP only. All future multi-tenant work requires new policies.
ALTER TABLE rag.embedding_space ENABLE ROW LEVEL SECURITY;
ALTER TABLE rag.source ENABLE ROW LEVEL SECURITY;
ALTER TABLE rag.document ENABLE ROW LEVEL SECURITY;
ALTER TABLE rag.document_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE rag.chunk_set ENABLE ROW LEVEL SECURITY;
ALTER TABLE rag.chunk ENABLE ROW LEVEL SECURITY;
ALTER TABLE rag.index_build ENABLE ROW LEVEL SECURITY;
ALTER TABLE rag.document_publication ENABLE ROW LEVEL SECURITY;
ALTER TABLE rag.ingestion_job ENABLE ROW LEVEL SECURITY;

CREATE POLICY rag_app_space ON rag.embedding_space FOR ALL TO rag_app USING (true) WITH CHECK (true);
CREATE POLICY rag_app_source ON rag.source FOR ALL TO rag_app
  USING (tenant_id = 'public') WITH CHECK (tenant_id = 'public');
CREATE POLICY rag_app_document ON rag.document FOR ALL TO rag_app
  USING (tenant_id = 'public') WITH CHECK (tenant_id = 'public');
CREATE POLICY rag_app_version ON rag.document_version FOR ALL TO rag_app USING (true) WITH CHECK (true);
CREATE POLICY rag_app_set ON rag.chunk_set FOR ALL TO rag_app USING (true) WITH CHECK (true);
CREATE POLICY rag_app_chunk ON rag.chunk FOR ALL TO rag_app USING (true) WITH CHECK (true);
CREATE POLICY rag_app_build ON rag.index_build FOR ALL TO rag_app USING (true) WITH CHECK (true);
CREATE POLICY rag_app_publication ON rag.document_publication FOR ALL TO rag_app USING (true) WITH CHECK (true);
CREATE POLICY rag_app_job ON rag.ingestion_job FOR ALL TO rag_app
  USING (tenant_id = 'public') WITH CHECK (tenant_id = 'public');

GRANT USAGE ON SCHEMA rag TO rag_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  rag.embedding_space, rag.source, rag.document, rag.document_version,
  rag.chunk_set, rag.chunk, rag.index_build, rag.document_publication,
  rag.ingestion_job TO rag_app;
-- Namespace enforcement in PgVector space tables is added separately by the
-- operator AFTER privileged createIndex, never by app bootstrap.
COMMIT;
