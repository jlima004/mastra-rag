import { createSupabaseVectorStore } from '../src/mastra/storage/supabase-vector.ts';
import { verifySupabaseFoundation } from '../src/mastra/storage/supabase-probe.ts';
import { describeDatabaseCheckFailure } from '../src/mastra/storage/supabase-diagnostics.ts';

async function main(): Promise<void> {
  const store = createSupabaseVectorStore();
  let failure: unknown;
  let failed = false;

  try {
    await verifySupabaseFoundation(store.pool);
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
  console.info('Supabase foundation check passed: pgvector and private rag schema ready.');
}

main().catch(error => {
  const diagnostic = describeDatabaseCheckFailure(error);
  // Never print raw driver errors, their causes, or the connection URL.
  console.error(`Supabase foundation check failed [${diagnostic.category}]. ${diagnostic.suggestion}`);
  process.exitCode = 1;
});
