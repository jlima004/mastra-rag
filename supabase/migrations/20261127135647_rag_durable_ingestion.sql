-- Candidate E2-MVP migration. Apply after E1 operator provisioning of the
-- PgVector space and its namespace policies. Hosted application is separate.
BEGIN;

-- Token-grid rendering permits 32768 UTF-16 code units, including context.
-- A well-formed scalar occupies at most 3 UTF-8 bytes per UTF-16 code unit.
-- Only the S512 path requires this widened envelope. The legacy alternative
-- retains E1 semantics and the global measured-token constraint stays in force.
ALTER TABLE rag.chunk
  DROP CONSTRAINT chunk_byte_count_check,
  ADD CONSTRAINT chunk_byte_count_check CHECK (
    byte_count BETWEEN 1 AND 1024 OR (
      byte_count BETWEEN 1 AND 98304
      AND measured_tokenizer IS NOT DISTINCT FROM 'cl100k_base/js-tiktoken@1.0.21'
      AND measured_token_count IS NOT NULL AND measured_token_count BETWEEN 1 AND 512
      AND byte_count = octet_length(content)
    )
  );

ALTER TABLE rag.chunk_set
  ALTER COLUMN normalized_text DROP NOT NULL,
  ADD CONSTRAINT chunk_set_purged_content_check CHECK (
    normalized_text IS NOT NULL OR header_metadata_canonical_json IS NULL
  );
COMMENT ON COLUMN rag.chunk_set.normalized_text IS
  'NULL after all vector projections and chunk rows have been purged. Identity/provenance stays for publication history and the spend ledger.';
COMMENT ON COLUMN rag.chunk_set.total_byte_budget IS
  'Total rendered UTF-8 bytes, with the original per-document bound. Measured model tokens are stored separately.';

ALTER TABLE rag.document
  ADD COLUMN purge_pending_at timestamptz,
  ADD COLUMN purged_at timestamptz,
  ADD COLUMN purge_error_code text CHECK (purge_error_code = 'E2_PURGE_RETRY_REQUIRED'),
  ADD CONSTRAINT document_purge_state_check CHECK (
    (purge_pending_at IS NULL OR (deleted_at IS NOT NULL AND purged_at IS NULL))
    AND (purged_at IS NULL OR deleted_at IS NOT NULL)
    AND (purge_error_code IS NULL OR purge_pending_at IS NOT NULL)
  );

ALTER TABLE rag.ingestion_job
  ADD COLUMN fence bigint NOT NULL DEFAULT 0 CHECK (fence >= 0),
  ADD COLUMN observed_at timestamptz;
CREATE UNIQUE INDEX ingestion_job_one_active
  ON rag.ingestion_job (document_id, space_id)
  WHERE kind = 'ingest' AND status = 'running';

CREATE POLICY rag_vector_delete ON rag.chunks_te3s_1536_v1
  FOR DELETE TO rag_app USING (namespace = 'public');
GRANT DELETE ON rag.chunks_te3s_1536_v1 TO rag_app;

-- The ledger definitions follow in the same atomic migration.
-- One H11 budget scope covers all workers for the approved billing project.
-- Attempt rows and exposure survive document erasure and job termination.
CREATE TABLE rag.embedding_reservation (
  job_id uuid PRIMARY KEY REFERENCES rag.ingestion_job (job_id),
  budget_scope text NOT NULL DEFAULT 'h11-rag-mastra' CHECK (budget_scope = 'h11-rag-mastra'),
  purpose text NOT NULL CHECK (purpose IN ('ingestion', 'evaluation', 'query')),
  model_id text NOT NULL CHECK (model_id = 'openai/text-embedding-3-small'),
  space_id text NOT NULL REFERENCES rag.embedding_space (space_id)
    CHECK (space_id = 'chunks_te3s_1536_v1'),
  utc_day date NOT NULL,
  utc_month date GENERATED ALWAYS AS
    (make_date(EXTRACT(YEAR FROM utc_day)::integer, EXTRACT(MONTH FROM utc_day)::integer, 1)) STORED,
  measured_tokens integer NOT NULL CHECK (measured_tokens BETWEEN 1 AND 150000),
  reserved_tokens integer NOT NULL CHECK (reserved_tokens BETWEEN measured_tokens AND 150000),
  estimated_micro_usd bigint NOT NULL CHECK (estimated_micro_usd > 0),
  exposure_tokens numeric NOT NULL DEFAULT 0 CHECK (exposure_tokens >= 0),
  held_tokens numeric GENERATED ALWAYS AS (
    CASE WHEN closed_at IS NULL THEN greatest(reserved_tokens, exposure_tokens)
    ELSE exposure_tokens END
  ) STORED,
  batch_plan jsonb NOT NULL CHECK (
    jsonb_typeof(batch_plan) = 'array' AND jsonb_array_length(batch_plan) BETWEEN 1 AND 2000
  ),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  closed_at timestamptz
);

CREATE TABLE rag.embedding_attempt (
  attempt_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES rag.embedding_reservation (job_id),
  batch_index integer NOT NULL CHECK (batch_index BETWEEN 0 AND 1999),
  attempt_number integer NOT NULL CHECK (attempt_number BETWEEN 1 AND 4),
  input_hash text NOT NULL CHECK (input_hash ~ '^[a-f0-9]{64}$'),
  reserved_tokens integer NOT NULL CHECK (reserved_tokens BETWEEN 1 AND 65536),
  state text NOT NULL DEFAULT 'started'
    CHECK (state IN ('started', 'retryable', 'unknown', 'succeeded', 'invalid', 'overage')),
  reported_tokens bigint CHECK (reported_tokens BETWEEN 1 AND 9007199254740991),
  error_code text CHECK (error_code ~ '^EMBED_[A-Z_]+$'),
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  finished_at timestamptz,
  retry_at timestamptz,
  reconciled_at timestamptz,
  reconciled_tokens bigint CHECK (reconciled_tokens BETWEEN 0 AND 9007199254740991),
  UNIQUE (job_id, batch_index, attempt_number),
  CHECK ((state = 'started') = (finished_at IS NULL)),
  CHECK ((reconciled_at IS NULL) = (reconciled_tokens IS NULL)),
  CHECK ((state = 'retryable') = (retry_at IS NOT NULL)),
  CHECK (state <> 'succeeded' OR (reported_tokens IS NOT NULL AND reported_tokens BETWEEN 1 AND reserved_tokens)),
  CHECK (state <> 'overage' OR (reported_tokens IS NOT NULL AND reported_tokens > reserved_tokens))
);

CREATE UNIQUE INDEX embedding_attempt_active_idx ON rag.embedding_attempt (job_id)
  WHERE state = 'started';
CREATE INDEX embedding_reservation_period_idx ON rag.embedding_reservation (budget_scope, utc_month);
CREATE INDEX embedding_attempt_unreconciled_overage_idx ON rag.embedding_attempt (job_id)
  WHERE state = 'overage' AND reconciled_at IS NULL;

ALTER TABLE rag.embedding_reservation ENABLE ROW LEVEL SECURITY;
ALTER TABLE rag.embedding_attempt ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON rag.embedding_reservation, rag.embedding_attempt FROM PUBLIC, anon, authenticated;
CREATE POLICY rag_app_reservation_read ON rag.embedding_reservation FOR SELECT TO rag_app
  USING (budget_scope = 'h11-rag-mastra');
CREATE POLICY rag_app_reservation_insert ON rag.embedding_reservation FOR INSERT TO rag_app
  WITH CHECK (budget_scope = 'h11-rag-mastra');
CREATE POLICY rag_app_reservation_update ON rag.embedding_reservation FOR UPDATE TO rag_app
  USING (budget_scope = 'h11-rag-mastra') WITH CHECK (budget_scope = 'h11-rag-mastra');
CREATE POLICY rag_app_attempt_read ON rag.embedding_attempt FOR SELECT TO rag_app
  USING (EXISTS (SELECT 1 FROM rag.embedding_reservation r WHERE r.job_id = embedding_attempt.job_id));
CREATE POLICY rag_app_attempt_insert ON rag.embedding_attempt FOR INSERT TO rag_app
  WITH CHECK (EXISTS (SELECT 1 FROM rag.embedding_reservation r WHERE r.job_id = embedding_attempt.job_id));
CREATE POLICY rag_app_attempt_update ON rag.embedding_attempt FOR UPDATE TO rag_app
  USING (EXISTS (SELECT 1 FROM rag.embedding_reservation r WHERE r.job_id = embedding_attempt.job_id))
  WITH CHECK (EXISTS (SELECT 1 FROM rag.embedding_reservation r WHERE r.job_id = embedding_attempt.job_id));
GRANT SELECT ON rag.embedding_reservation, rag.embedding_attempt TO rag_app;
GRANT INSERT (job_id, purpose, model_id, space_id, utc_day, measured_tokens, reserved_tokens,
  estimated_micro_usd, batch_plan) ON rag.embedding_reservation TO rag_app;
GRANT UPDATE (exposure_tokens, closed_at) ON rag.embedding_reservation TO rag_app;
GRANT INSERT (job_id, batch_index, attempt_number, input_hash, reserved_tokens)
  ON rag.embedding_attempt TO rag_app;
GRANT UPDATE (state, reported_tokens, error_code, finished_at, retry_at) ON rag.embedding_attempt TO rag_app;

COMMIT;
