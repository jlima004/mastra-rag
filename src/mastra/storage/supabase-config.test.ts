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

test('rejects duplicate sslmode parameters, even when the first requires TLS', () => {
  for (const candidate of [
    `${direct}&sslmode=disable`,
    `${direct}&sslmode=prefer`,
    `${direct}&sslmode=verify-full`,
    `${session}&sslmode=disable`,
    direct.replace('sslmode=require', 'sslmode=disable&sslmode=require'),
  ]) {
    assert.throws(
      () => requirePostgresConnectionString({ POSTGRES_CONNECTION_STRING: candidate }),
      /PostgreSQL connection parameters/,
    );
  }
});

test('rejects driver-level overrides of validated host, port and credentials', () => {
  for (const [parameter, value] of [
    ['host', 'example.org'],
    ['port', '6543'],
    ['user', 'other-user'],
    ['password', 'overridden-password'],
    ['database', 'other-database'],
    ['ssl', '0'],
    ['uselibpqcompat', 'true'],
    ['sslmode', 'disable'],
    ['application_name', 'unauthorized'],
    ['sslrootcert', '/tmp/ca.pem'],
  ]) {
    for (const url of [direct, session]) {
      const candidate = `${url}&${parameter}=${encodeURIComponent(value)}`;
      assert.throws(
        () => requirePostgresConnectionString({ POSTGRES_CONNECTION_STRING: candidate }),
        /PostgreSQL connection parameters/,
        `unexpectedly accepted connection parameter: ${parameter}`,
      );
    }
  }
});

test('rejects encoded parameter aliases and unexpected TLS options', () => {
  for (const candidate of [
    `${direct}&h%6fst=example.org`,
    `${direct}&SSLmode=disable`,
    `${direct}&sslmode%00=disable`,
    direct.replace('sslmode=require', 'sslmode=require%26host%3Dexample.org'),
    direct.replace('sslmode=require', 'sslmode=require;host=example.org'),
    direct.replace('sslmode=require', 'sslmode=allow'),
    direct.replace('sslmode=require', 'application_name=my-app'),
  ]) {
    assert.throws(
      () => requirePostgresConnectionString({ POSTGRES_CONNECTION_STRING: candidate }),
      /PostgreSQL connection parameters/,
    );
  }
});

test('canonicalizes encoded TLS key and unescaped password whitespace before driver handoff', () => {
  const encodedKey = direct.replace('?sslmode=require', '?ssl%6dode=require');
  assert.equal(
    requirePostgresConnectionString({ POSTGRES_CONNECTION_STRING: encodedKey }),
    direct,
  );

  const source = direct.replace('s3cret', 's cret').replace('sslmode', 'ssl%6dode');
  const canonical = direct.replace('s3cret', 's%20cret');
  assert.equal(
    requirePostgresConnectionString({ POSTGRES_CONNECTION_STRING: source }),
    canonical,
  );
});

test('leaves canonical valid session pooler URLs unchanged', () => {
  assert.equal(
    requirePostgresConnectionString({ POSTGRES_CONNECTION_STRING: session }),
    session,
  );
});
