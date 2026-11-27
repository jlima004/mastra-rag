-- LOCAL disposable database only. E2 down is limited to rehearsals before use.
-- Retained ledger rows, purged payloads and E2 claims must be preserved once used.
BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT FROM rag.embedding_reservation)
    OR EXISTS (SELECT FROM rag.ingestion_job WHERE fence <> 0 OR observed_at IS NOT NULL)
    OR EXISTS (SELECT FROM rag.chunk WHERE byte_count > 1024)
    OR EXISTS (SELECT FROM rag.chunk_set WHERE normalized_text IS NULL)
    OR EXISTS (SELECT FROM rag.document WHERE purge_pending_at IS NOT NULL OR purged_at IS NOT NULL)
  THEN
    RAISE EXCEPTION 'E2_DOWN_REQUIRES_UNUSED_MIGRATION';
  END IF;
END
$$;

DROP TABLE rag.embedding_attempt;
DROP TABLE rag.embedding_reservation;
REVOKE DELETE ON rag.chunks_te3s_1536_v1 FROM rag_app;
DROP POLICY rag_vector_delete ON rag.chunks_te3s_1536_v1;
DROP INDEX rag.ingestion_job_one_active;
ALTER TABLE rag.ingestion_job DROP COLUMN fence, DROP COLUMN observed_at;
ALTER TABLE rag.document DROP COLUMN purge_pending_at, DROP COLUMN purged_at, DROP COLUMN purge_error_code;
ALTER TABLE rag.chunk_set
  ALTER COLUMN normalized_text SET NOT NULL,
  DROP CONSTRAINT chunk_set_purged_content_check;
COMMENT ON COLUMN rag.chunk_set.normalized_text IS NULL;
COMMENT ON COLUMN rag.chunk_set.total_byte_budget IS NULL;
ALTER TABLE rag.chunk
  DROP CONSTRAINT chunk_byte_count_check,
  ADD CONSTRAINT chunk_byte_count_check CHECK (byte_count BETWEEN 1 AND 1024);

COMMIT;
