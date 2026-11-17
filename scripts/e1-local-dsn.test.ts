import assert from 'node:assert/strict';
import test from 'node:test';
import { requireE1LocalDatabaseUrl } from './e1-local-dsn.ts';

const valid = 'postgresql://postgres:e1-local-ci-only@127.0.0.1:54329/rag_e1?sslmode=disable';

test('E1 local-only DSN: accepts exact disposable target and canonicalizes the input', () => {
  assert.equal(requireE1LocalDatabaseUrl(valid), valid);
  assert.equal(requireE1LocalDatabaseUrl(
    'postgresql://postgres:e1-local-ci-only@127.0.0.1:54329/rag_e1?%73slmode=disable',
  ), valid);
  assert.equal(requireE1LocalDatabaseUrl(
    'postgresql://postgres:e1-local-ci-only@127.0.0.1:54329/rag_e1?sslmode=dis%61ble',
  ), valid);
});

test('E1 local-only DSN: rejects every driver-level override and extra query option', () => {
  const invalid = [
    valid + '&host=remote.example',
    valid + '&port=5432',
    valid + '&user=operator',
    valid + '&password=other',
    valid + '&database=postgres',
    valid + '&ssl=0',
    valid + '&sslmode=require',
    valid + '&sslmode=disable',
    valid + '&%68ost=remote.example',
    valid + '&%73slmode=require',
    valid + '&hostaddr=192.0.2.1',
    valid + '&application_name=e1-test',
    valid + '&options=-csearch_path=public',
    valid.replace('sslmode=disable', 'sslmode=require'),
    valid.replace('sslmode=disable', 'sslmode=verify-full'),
    valid.replace('sslmode=disable', 'SSLmode=disable'),
    valid.replace('sslmode=disable', 'host=127.0.0.1'),
    valid.replace('?sslmode=disable', ''),
    valid.replace('?sslmode=disable', '?'),
  ];
  for (const input of invalid) {
    assert.throws(() => requireE1LocalDatabaseUrl(input), { message: 'E1_LOCAL_ONLY' });
  }
});

test('E1 local-only DSN: refuses non-disposable authority, path, credentials and fragments', () => {
  const invalid = [
    valid.replace('127.0.0.1', 'db.example.invalid'),
    valid.replace('127.0.0.1', 'localhost'),
    valid.replace('127.0.0.1', '127.0.0.2'),
    valid.replace('127.0.0.1', '[::1]'),
    valid.replace(':54329/', ':5432/'),
    valid.replace('/rag_e1?', '/postgres?'),
    valid.replace('/rag_e1?', '/rag_e1/other?'),
    valid.replace('postgres:', 'rag_app:'),
    valid.replace('postgres:e1-local-ci-only', 'postgres:'),
    valid.replace('postgresql:', 'postgres:'),
    valid.replace('postgresql:', 'https:'),
    valid + '#fragment',
    'not-a-url',
  ];
  for (const input of invalid) {
    assert.throws(() => requireE1LocalDatabaseUrl(input), { message: 'E1_LOCAL_ONLY' });
  }
  for (const value of [undefined, null, {}, 123, '']) {
    assert.throws(() => requireE1LocalDatabaseUrl(value), { message: 'E1_LOCAL_ONLY' });
  }
});

test('E1 local-only DSN: does not echo a credential-bearing invalid DSN in errors', () => {
  const invalid = 'postgresql://postgres:private-test-password@127.0.0.1:54329/rag_e1?sslmode=disable&host=remote.example';
  assert.throws(() => requireE1LocalDatabaseUrl(invalid), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(error.message, 'E1_LOCAL_ONLY');
    assert.equal(error.message.includes('private-test-password'), false);
    return true;
  });
});
