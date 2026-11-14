import { PgVector } from '@mastra/pg';
import {
  RAG_SCHEMA_NAME,
  requirePostgresConnectionString,
  type DatabaseEnvironment,
} from './supabase-config.ts';

/**
 * Construct lazily: Mastra can build and start before DB secrets are configured.
 * Index creation and data ingestion belong to later milestones.
 */
export function createSupabaseVectorStore(
  environment: DatabaseEnvironment = process.env,
): PgVector {
  return new PgVector({
    id: 'supabase-rag-vectors',
    connectionString: requirePostgresConnectionString(environment),
    schemaName: RAG_SCHEMA_NAME,
    max: 2,
    idleTimeoutMillis: 10_000,
    pgPoolOptions: { connectionTimeoutMillis: 5_000 },
  });
}
