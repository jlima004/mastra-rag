import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveRuntimeStorage } from './runtime-storage.ts';

const cloud = { MASTRA_ENVIRONMENT_ID: 'production' };
const url = 'libsql://project.example.turso.io';
const authToken = 'private-test-token';

test('local Mastra runtime uses an ignored persistent file', () => {
  assert.deepEqual(resolveRuntimeStorage({}), { url: 'file:./mastra.db' });
});
test('cloud runtime never falls back to ephemeral storage', () => {
  assert.throws(() => resolveRuntimeStorage(cloud), /managed Turso database/);
  assert.throws(() => resolveRuntimeStorage({ ...cloud, TURSO_DATABASE_URL: 'file:./mastra.db' }), /cannot use local file/);
  assert.throws(() => resolveRuntimeStorage({ ...cloud, TURSO_DATABASE_URL: url }), /TURSO_AUTH_TOKEN/);
});
test('validates remote Turso inputs without leaking secrets', () => {
  assert.deepEqual(resolveRuntimeStorage({ ...cloud, TURSO_DATABASE_URL: url, TURSO_AUTH_TOKEN: authToken }), { url, authToken });
  for (const candidate of ['invalid-url', 'http://project.example.turso.io', 'libsql://user:pass@project.example.turso.io']) {
    assert.throws(() => resolveRuntimeStorage({ ...cloud, TURSO_DATABASE_URL: candidate, TURSO_AUTH_TOKEN: authToken }));
  }
});
