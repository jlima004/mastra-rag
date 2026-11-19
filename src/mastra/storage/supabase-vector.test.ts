import assert from 'node:assert/strict';
import test from 'node:test';
import { createSupabaseVectorStore } from './supabase-vector.ts';

test('Mastra hosted runtime refuses missing project CA without contacting the database', () => {
  const dsn = 'postgresql://rag_app.lmocjhpajhxegzobydau:synthetic@aws-0-sa-east-1.pooler.supabase.com:5432/postgres?sslmode=verify-full';
  assert.throws(
    () => createSupabaseVectorStore({POSTGRES_CONNECTION_STRING: dsn, MASTRA_ENVIRONMENT_ID:'synthetic-hosted'}),
    /SUPABASE_CA_CERT_BASE64 is required/,
  );
});

test('Mastra hosted runtime refuses an admin DSN without contacting the database', () => {
  assert.throws(
    () => createSupabaseVectorStore({
      POSTGRES_CONNECTION_STRING: 'postgresql://postgres.lmocjhpajhxegzobydau:synthetic@aws-0-sa-east-1.pooler.supabase.com:5432/postgres?sslmode=verify-full',
      MASTRA_ENVIRONMENT_ID:'synthetic-hosted',
    }),
    /rag_app session pooler/,
  );
});
