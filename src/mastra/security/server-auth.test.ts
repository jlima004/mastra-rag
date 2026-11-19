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

test('H7 operator-only: reject inherited JS object keys and wrong bearer tokens', async () => {
  const configured = createServerAuth({ RAG_SERVER_API_TOKEN: token });
  const denyAll = createServerAuth({});
  for (const candidate of [
    '__proto__', 'constructor', 'prototype', 'toString',
    'valueOf', 'hasOwnProperty', 'random-invalid-operator-token',
  ]) {
    const request = new Request('http://localhost:4111/internal/readiness/supabase', {
      headers: { Authorization: 'Bearer ' + candidate },
    });
    assert.equal(await configured.getCurrentUser(request), null, candidate);
    assert.equal(await denyAll.getCurrentUser(request), null, candidate);
  }

  const validRequest = new Request('http://localhost:4111/internal/readiness/supabase', {
    headers: { Authorization: 'Bearer ' + token },
  });
  const actual = await configured.getCurrentUser(validRequest);
  assert.equal(actual?.id, 'rag-operator');
  assert.equal(actual?.role, 'admin');
});

test('H7 operator-only: reject prototype keys from alternate auth inputs', async () => {
  const provider = createServerAuth({ RAG_SERVER_API_TOKEN: token });
  const attacks: Array<Record<string, string>> = [
    { 'X-Playground-Access': 'constructor' },
    { Cookie: 'mastra-token=__proto__' },
    { Cookie: 'mastra-token=toString' },
  ];
  for (const headers of attacks) {
    const request = new Request('http://localhost:4111/internal/readiness/supabase', { headers });
    assert.equal(await provider.getCurrentUser(request), null);
  }
});
