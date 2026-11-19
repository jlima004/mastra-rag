-- E1 local-only operator provisioning follow-up; run after the local
-- PgVector createIndex({type:'flat'}) action. Do not run against Supabase.
BEGIN;
ALTER TABLE rag.chunks_te3s_1536_v1 ENABLE ROW LEVEL SECURITY;

CREATE POLICY rag_vector_select ON rag.chunks_te3s_1536_v1
  FOR SELECT TO rag_app USING (namespace = 'public');
CREATE POLICY rag_vector_insert ON rag.chunks_te3s_1536_v1
  FOR INSERT TO rag_app WITH CHECK (namespace = 'public');
CREATE POLICY rag_vector_update ON rag.chunks_te3s_1536_v1
  FOR UPDATE TO rag_app USING (namespace = 'public')
  WITH CHECK (namespace = 'public');

GRANT SELECT,INSERT,UPDATE ON rag.chunks_te3s_1536_v1 TO rag_app;
-- Verify the sequence name in the frozen PgVector 1.35.0 integration.
GRANT USAGE ON SEQUENCE rag.chunks_te3s_1536_v1_id_seq TO rag_app;
COMMIT;
