import assert from 'node:assert/strict';
import test from 'node:test';
import { describeDatabaseCheckFailure } from './supabase-diagnostics.ts';

test('classifies PostgreSQL authentication error without echoing raw driver messages', () => {
  const secret = 'SENSITIVE_PASSWORD_SHOULD_NOT_APPEAR';
  const diagnostic = describeDatabaseCheckFailure({
    code: '28P01',
    message: `password authentication failed for postgres with ${secret}`,
  });
  assert.equal(diagnostic.category, 'AUTHENTICATION');
  assert.doesNotMatch(JSON.stringify(diagnostic), /SENSITIVE_PASSWORD/);
});

test('classifies TLS, networking, and project validation errors', () => {
  assert.equal(describeDatabaseCheckFailure({ code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' }).category, 'TLS_CERTIFICATE');
  assert.equal(describeDatabaseCheckFailure({ code: 'ENOTFOUND' }).category, 'NETWORK');
  assert.equal(
    describeDatabaseCheckFailure(new Error('POSTGRES_CONNECTION_STRING must be set on the server.')).category,
    'CONFIGURATION',
  );
  assert.equal(
    describeDatabaseCheckFailure(new Error('Supabase pgvector extension or private rag schema is unavailable.')).category,
    'FOUNDATION',
  );
});

test('recognizes nested driver causes and never emits unknown error strings', () => {
  const sensitive = 'postgresql://postgres:NEVER_LOG_THIS@example.org:5432/postgres';
  const diagnostic = describeDatabaseCheckFailure({
    message: sensitive,
    cause: { code: '28P01', message: sensitive },
  });
  assert.equal(diagnostic.category, 'AUTHENTICATION');
  assert.doesNotMatch(JSON.stringify(diagnostic), /NEVER_LOG_THIS|postgresql:\/\//);

  const unknown = describeDatabaseCheckFailure(new Error(sensitive));
  assert.equal(unknown.category, 'UNCLASSIFIED');
  assert.doesNotMatch(JSON.stringify(unknown), /NEVER_LOG_THIS|postgresql:\/\//);
});
