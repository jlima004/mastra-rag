create extension if not exists vector with schema extensions;
create schema if not exists rag;
revoke all on schema rag from public;
revoke all on schema rag from anon, authenticated;