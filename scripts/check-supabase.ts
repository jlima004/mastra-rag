import { createSupabaseVectorStore } from '../src/mastra/storage/supabase-vector.ts';
import { verifySupabaseFoundation } from '../src/mastra/storage/supabase-probe.ts';

async function main(): Promise<void> {
  const store = createSupabaseVectorStore();
  try {
    await verifySupabaseFoundation(store.pool);
    console.info('Supabase foundation check passed: pgvector and private rag schema ready.');
  } finally {
    await store.disconnect();
  }
}

main().catch(() => {
  // Do not print raw database errors: connection details can contain credentials.
  console.error('Supabase foundation check failed. Verify the server-only DSN, TLS, project and database permissions.');
  process.exitCode = 1;
});
