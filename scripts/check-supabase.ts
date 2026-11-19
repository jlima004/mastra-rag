import { createSupabaseVectorStore } from '../src/mastra/storage/supabase-vector.ts';
import { verifySupabaseRuntimeReadonly } from '../src/mastra/storage/supabase-runtime-probe.ts';
import { describeDatabaseCheckFailure } from '../src/mastra/storage/supabase-diagnostics.ts';

async function main(): Promise<void> {
  const store = createSupabaseVectorStore();
  let failure: unknown;
  let failed = false;

  try {
    await verifySupabaseRuntimeReadonly(store.pool);
  } catch (error) {
    failed = true;
    failure = error;
  } finally {
    try {
      await store.disconnect();
    } catch (disconnectError) {
      // Preserve the original probe error if cleanup also fails.
      if (!failed) {
        failure = disconnectError;
        failed = true;
      }
    }
  }

  if (failed) throw failure;
  console.info('E1 runtime read-only check passed: rag_app identity, vector catalog and RLS ready.');
}

main().catch(error => {
  const diagnostic = describeDatabaseCheckFailure(error);
  // Never print raw driver errors, their causes, or the connection URL.
  console.error(`E1 runtime read-only check failed [${diagnostic.category}]. ${diagnostic.suggestion}`);
  process.exitCode = 1;
});
