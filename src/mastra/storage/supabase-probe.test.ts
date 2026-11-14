import assert from 'node:assert/strict';
import test from 'node:test';
import { FOUNDATION_PROBE_SQL, verifySupabaseFoundation } from './supabase-probe.ts';

const ready = {
  vector_enabled: true,
  rag_schema_exists: true,
  anon_has_schema_usage: false,
  authenticated_has_schema_usage: false,
};

test('probe is a single read-only SELECT', () => {
  assert.match(FOUNDATION_PROBE_SQL.trim(), /^SELECT\b/);
  assert.doesNotMatch(FOUNDATION_PROBE_SQL, /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i);
});

test('accepts an initialized private Supabase schema', async () => {
  await verifySupabaseFoundation({ query: async () => ({ rows: [ready] }) });
});

test('fails if extension, schema, or restricted access checks fail', async () => {
  for (const override of [
    { vector_enabled: false },
    { rag_schema_exists: false },
    { anon_has_schema_usage: true },
    { authenticated_has_schema_usage: true },
  ]) {
    await assert.rejects(
      () => verifySupabaseFoundation({ query: async () => ({ rows: [{ ...ready, ...override }] }) }),
    );
  }
  await assert.rejects(() => verifySupabaseFoundation({ query: async () => ({ rows: [] }) }));
});
