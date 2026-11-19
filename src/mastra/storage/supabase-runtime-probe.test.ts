import assert from 'node:assert/strict';
import test from 'node:test';
import {
  RAG_VECTOR_SPACE_ID, RAG_VECTOR_NAMESPACE, RUNTIME_READONLY_PROBE_SQL,
  verifySupabaseRuntimeReadonly,
} from './supabase-runtime-probe.ts';

test('E1 runtime probe uses a single static SELECT; namespace must be explicit', () => {
  assert.equal(RAG_VECTOR_SPACE_ID, 'chunks_te3s_1536_v1');
  assert.equal(RAG_VECTOR_NAMESPACE, 'public');
  assert.match(RUNTIME_READONLY_PROBE_SQL.trim(), /^SELECT\s*\(/);
  assert.equal(RUNTIME_READONLY_PROBE_SQL.includes(';'), false);
  assert.match(RUNTIME_READONLY_PROBE_SQL, /current_user = 'rag_app'/);
  assert.match(RUNTIME_READONLY_PROBE_SQL, /session_user = 'rag_app'/);
  assert.match(RUNTIME_READONLY_PROBE_SQL, /row_security_active/);
  assert.match(RUNTIME_READONLY_PROBE_SQL, /vector\(1536\)/);
  assert.match(RUNTIME_READONLY_PROBE_SQL, /'rag_vector_update'/);
});

test('P1: vector column uses schema-qualified OID and integer dimension regardless of search_path', () => {
  assert.match(RUNTIME_READONLY_PROBE_SQL, /a\.atttypid='extensions\.vector'::regtype/);
  assert.match(RUNTIME_READONLY_PROBE_SQL, /a\.atttypmod=1536/);
  assert.doesNotMatch(RUNTIME_READONLY_PROBE_SQL, /format_type\(/);
});

test('P2: every RLS policy must match the full approved equality expression', () => {
  const expected = "'((namespace)::text = ''public''::text)'";
  for (const policy of ['rag_vector_select', 'rag_vector_insert', 'rag_vector_update']) {
    assert.match(RUNTIME_READONLY_PROBE_SQL, new RegExp("policyname='" + policy + "'"));
  }
  assert.equal(RUNTIME_READONLY_PROBE_SQL.split(expected).length - 1, 4);
  assert.doesNotMatch(RUNTIME_READONLY_PROBE_SQL, /LIKE\s*'%public%'/);
  assert.match(RUNTIME_READONLY_PROBE_SQL, /FROM pg_catalog\.pg_policies/);
  assert.match(RUNTIME_READONLY_PROBE_SQL, /count\(\*\)=3/);
});

test('E1 runtime probe accepts only one true result', async () => {
  await verifySupabaseRuntimeReadonly({ query: async () => ({ rows: [{ runtime_ready: true }] }) });
  for (const rows of [[], [{ runtime_ready: false }], [{ runtime_ready: true }, { runtime_ready: true }]]) {
    await assert.rejects(() => verifySupabaseRuntimeReadonly({ query: async () => ({ rows }) }),
      /Supabase runtime role/);
  }
});

test('E1 runtime probe does not reveal untrusted row content in fixed error text', async () => {
  await assert.rejects(() => verifySupabaseRuntimeReadonly({
    query: async () => ({ rows: [{ runtime_ready: false, injected: 'TOP_SECRET' } as never] }),
  }), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.doesNotMatch(error.message, /TOP_SECRET/);
    return true;
  });
});
