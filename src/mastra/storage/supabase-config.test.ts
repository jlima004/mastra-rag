import assert from 'node:assert/strict';
import test from 'node:test';
import {
  requirePostgresConnectionString,
  SUPABASE_PROJECT_REF,
} from './supabase-config.ts';

const direct = `postgresql://postgres:s3cret@db.${SUPABASE_PROJECT_REF}.supabase.co:5432/postgres?sslmode=require`;
const session = `postgresql://postgres.${SUPABASE_PROJECT_REF}:s3cret@aws-0-sa-east-1.pooler.supabase.com:5432/postgres?sslmode=require`;

test('accepts a TLS-protected connection to the configured Supabase database', () => {
  assert.equal(requirePostgresConnectionString({ POSTGRES_CONNECTION_STRING: direct }), direct);
  assert.equal(requirePostgresConnectionString({ POSTGRES_CONNECTION_STRING: session }), session);
  assert.equal(
    requirePostgresConnectionString({ POSTGRES_CONNECTION_STRING: direct.replace('sslmode=require', 'sslmode=verify-full') }),
    direct.replace('sslmode=require', 'sslmode=verify-full'),
  );
});

test('requires credentials without disclosing a credential value', () => {
  assert.throws(() => requirePostgresConnectionString({}), /POSTGRES_CONNECTION_STRING/);
  const secret = 'do-not-leak-this-password';
  assert.throws(
    () => requirePostgresConnectionString({ POSTGRES_CONNECTION_STRING: `postgresql://postgres:${secret}@example.org:5432/postgres?sslmode=require` }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.doesNotMatch(error.message, new RegExp(secret));
      return true;
    },
  );
});

test('rejects unsupported protocols, projects, missing credentials, and malformed URLs', () => {
  for (const candidate of [
    'not a url',
    'https://postgres:s3cret@example.org:5432/postgres?sslmode=require',
    direct.replace(`db.${SUPABASE_PROJECT_REF}`, 'db.another-project'),
    direct.replace(':s3cret@', ':@'),
    session.replace(`postgres.${SUPABASE_PROJECT_REF}`, 'postgres.other-project'),
  ]) {
    assert.throws(() => requirePostgresConnectionString({ POSTGRES_CONNECTION_STRING: candidate }));
  }
});

test('rejects plain connections, transaction pooler, and wrong database', () => {
  for (const candidate of [
    direct.replace('?sslmode=require', ''),
    direct.replace('sslmode=require', 'sslmode=disable'),
    session.replace(':5432/', ':6543/'),
    direct.replace('/postgres?', '/other?'),
  ]) {
    assert.throws(() => requirePostgresConnectionString({ POSTGRES_CONNECTION_STRING: candidate }));
  }
});
