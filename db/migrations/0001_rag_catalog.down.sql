-- RAG-E1 LOCAL/EMERGENCY DOWN candidate. Requires explicit owner approval remotely.
-- No CASCADE: refuse to destroy dependent data/objects by surprise.
BEGIN;
REVOKE SELECT, INSERT, UPDATE, DELETE ON
  rag.embedding_space, rag.source, rag.document, rag.document_version,
  rag.chunk_set, rag.chunk, rag.index_build, rag.document_publication,
  rag.ingestion_job FROM rag_app;
DROP TABLE rag.ingestion_job;
DROP TABLE rag.document_publication;
DROP TABLE rag.index_build;
DROP TABLE rag.chunk;
DROP TABLE rag.chunk_set;
DROP TABLE rag.document_version;
DROP TABLE rag.document;
DROP TABLE rag.source;
DROP TABLE rag.embedding_space;
-- Do not drop pre-existing rag schema, pgvector extension or rag_app role.
COMMIT;
