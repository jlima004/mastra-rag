import assert from 'node:assert/strict';
import test from 'node:test';
import { createServerAuth, resolveServerToken } from './server-auth.ts';

const token = 'a'.repeat(64);

test('platform startup requires a token', () => {
  assert.throws(() => resolveServerToken({ MASTRA_ENVIRONMENT_ID: 'production' }), /Configure RAG_SERVER_API_TOKEN/);
  assert.throws(() => createServerAuth({ MASTRA_PROJECT_ID: 'project' }), /Configure RAG_SERVER_API_TOKEN/);
});
test('rejects weak or padded credentials without echoing secrets', () => {
  for (const candidate of ['short', ` ${token}`, `${token} `]) {
    assert.throws(() => resolveServerToken({ RAG_SERVER_API_TOKEN: candidate }),
      (e: unknown) => { assert.ok(e instanceof Error); assert.doesNotMatch(e.message, /aaaaa/); return true; });
  }
});
test('accepts strong credential and creates a deny-all local provider if missing', () => {
  assert.equal(resolveServerToken({ RAG_SERVER_API_TOKEN: token }), token);
  assert.equal(resolveServerToken({}), undefined);
  assert.ok(createServerAuth({}));
  assert.ok(createServerAuth({ RAG_SERVER_API_TOKEN: token }));
});
