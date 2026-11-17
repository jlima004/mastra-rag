import { PgVector } from '@mastra/pg';
import { resolveSupabaseTlsOptions } from './supabase-tls.ts';
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
  const connectionString = requirePostgresConnectionString(environment);
  const ssl = resolveSupabaseTlsOptions(connectionString, environment);

  return new PgVector({
    id: 'supabase-rag-vectors',
    connectionString,
    ...(ssl ? { ssl } : {}),
    schemaName: RAG_SCHEMA_NAME,
    // E1: the runtime must never create/alter tables automatically.
    disableInit: true,
    max: 2,
    idleTimeoutMillis: 10_000,
    pgPoolOptions: { connectionTimeoutMillis: 5_000 },
  });
}
