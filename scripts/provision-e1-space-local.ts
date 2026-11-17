import { PgVector } from '@mastra/pg';
import { requireE1LocalDatabaseUrl } from './e1-local-dsn.ts';

/**
 * E1 review candidate: operator-only *local* provisioning of the first space.
 * The immutable guard refuses any hosted Supabase URL / alternate database.
 * This script is NEVER registered as a runtime route, tool or workflow.
 */
const connectionString = requireE1LocalDatabaseUrl(
  process.env.E1_LOCAL_TEST_DATABASE_URL,
);

const vector = new PgVector({
  id: 'e1-disposable-local-only',
  connectionString,
  schemaName: 'rag',
  max: 2,
});
try {
  await vector.createIndex({
    indexName: 'chunks_te3s_1536_v1',
    dimension: 1536,
    metric: 'cosine',
    indexConfig: { type: 'flat' },
  });
  console.log('E1_LOCAL_FLAT_SPACE_PROVISIONED');
} finally {
  await vector.pool.end();
}
