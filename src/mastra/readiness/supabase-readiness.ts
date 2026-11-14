import { registerApiRoute } from '@mastra/core/server';
import { createSupabaseVectorStore } from '../storage/supabase-vector.ts';
import { verifySupabaseFoundation } from '../storage/supabase-probe.ts';

/**
 * On-demand read-only PostgreSQL probe. The result never includes credentials,
 * driver errors or SQL details. The platform /health remains unchanged.
 */
export async function checkSupabaseReadiness(): Promise<boolean> {
  let store: ReturnType<typeof createSupabaseVectorStore> | undefined;
  let healthy = false;
  try {
    store = createSupabaseVectorStore();
    await verifySupabaseFoundation(store.pool);
    healthy = true;
  } catch {
    // Never log database driver exceptions.
  } finally {
    if (store) {
      try { await store.disconnect(); }
      catch { healthy = false; }
    }
  }
  return healthy;
}

export const supabaseReadinessRoute = registerApiRoute('/internal/readiness/supabase', {
  method: 'GET',
  requiresAuth: true,
  handler: async c => {
    const ok = await checkSupabaseReadiness();
    return ok ? c.json({ status: 'ok' }, 200) : c.json({ status: 'unavailable' }, 503);
  },
});
