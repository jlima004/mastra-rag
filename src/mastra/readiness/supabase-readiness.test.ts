import assert from 'node:assert/strict';
import test from 'node:test';
import { supabaseReadinessRoute } from './supabase-readiness.ts';

test('readiness endpoint registration is available for server startup', () => {
  assert.ok(supabaseReadinessRoute);
});
