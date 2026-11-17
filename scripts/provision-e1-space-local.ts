import { PgVector } from '@mastra/pg';

/**
 * E1 review candidate: operator-only *local* provisioning of the first space.
 * The immutable guard refuses any hosted Supabase URL / alternate database.
 * This script is NEVER registered as a runtime route, tool or workflow.
 */
const uri = process.env.E1_LOCAL_TEST_DATABASE_URL;
if (!uri) throw new Error('E1_LOCAL_ONLY');
let url: URL;
try { url = new URL(uri); }
catch { throw new Error('E1_LOCAL_ONLY'); }
if (url.protocol !== 'postgresql:' ||
    url.hostname !== '127.0.0.1' || url.port !== '54329' ||
    url.pathname !== '/rag_e1' || url.username !== 'postgres' ||
    url.searchParams.get('sslmode') !== 'disable') {
  throw new Error('E1_LOCAL_ONLY');
}

const vector = new PgVector({
  id: 'e1-disposable-local-only',
  connectionString: uri,
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
