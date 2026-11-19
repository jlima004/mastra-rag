import { registerApiRoute } from '@mastra/core/server';
import { describeDatabaseCheckFailure } from '../storage/supabase-diagnostics.ts';
import { createSupabaseVectorStore } from '../storage/supabase-vector.ts';
import { verifySupabaseRuntimeReadonly } from '../storage/supabase-runtime-probe.ts';

export type SupabaseReadiness =
  | Readonly<{ status: 'ok' }>
  | Readonly<{ status: 'unavailable'; category: string }>;

type ReadinessStore = {
  pool: Parameters<typeof verifySupabaseRuntimeReadonly>[0];
  disconnect(): Promise<void>;
};

export type ReadinessDependencies = Readonly<{
  createStore(): ReadinessStore;
  verify(pool: ReadinessStore['pool']): Promise<void>;
}>;

const defaultDependencies: ReadinessDependencies = {
  createStore: createSupabaseVectorStore,
  verify: verifySupabaseRuntimeReadonly,
};

/**
 * Read-only probe, with fixed sanitized categories. Never return or log
 * driver errors, SQL, credentials, hostnames, or stack traces.
 * Preserve the original query failure if disconnection also fails.
 */
export async function diagnoseSupabaseReadiness(
  dependencies: ReadinessDependencies = defaultDependencies,
): Promise<SupabaseReadiness> {
  let store: ReadinessStore | undefined;
  let result: SupabaseReadiness = { status: 'ok' };

  try {
    store = dependencies.createStore();
    await dependencies.verify(store.pool);
  } catch (error: unknown) {
    result = { status: 'unavailable', category: describeDatabaseCheckFailure(error).category };
  } finally {
    if (store) {
      try {
        await store.disconnect();
      } catch (error: unknown) {
        if (result.status === 'ok') {
          result = { status: 'unavailable', category: describeDatabaseCheckFailure(error).category };
        }
      }
    }
  }
  return result;
}

/** Preserve the existing internal boolean helper. */
export async function checkSupabaseReadiness(): Promise<boolean> {
  return (await diagnoseSupabaseReadiness()).status === 'ok';
}

/** The Mastra platform /health remains separate from this authenticated route. */
export const supabaseReadinessRoute = registerApiRoute('/internal/readiness/supabase', {
  method: 'GET',
  requiresAuth: true,
  handler: async c => {
    const result = await diagnoseSupabaseReadiness();
    return result.status === 'ok'
      ? c.json({ status: 'ok' }, 200)
      : c.json(result, 503);
  },
});
