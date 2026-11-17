-- E1 disposable test environment ONLY. Never execute against hosted Supabase.
-- On fresh local pgvector/pgvector:pg17 service with database name rag_e1.
CREATE ROLE rag_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE SCHEMA rag AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA rag FROM PUBLIC;
CREATE SCHEMA extensions AUTHORIZATION postgres;
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;
GRANT USAGE ON SCHEMA extensions TO rag_app;
