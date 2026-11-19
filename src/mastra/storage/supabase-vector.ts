import { PgVector } from '@mastra/pg';
import { resolveSupabaseTlsOptions } from './supabase-tls.ts';
import {
  RAG_SCHEMA_NAME,
  requireRuntimeRagAppConnectionString,
  type DatabaseEnvironment,
} from './supabase-config.ts';

/**
 * Construct lazily: Mastra can build and start before DB secrets are configured.
 * Index creation and data ingestion belong to later milestones.
 */
export function createSupabaseVectorStore(
  environment: DatabaseEnvironment = process.env,
): PgVector {
  const connectionString = requireRuntimeRagAppConnectionString(environment);
  // Hosted runtime must use the verified project CA from a server-only secret.
  if ((environment.MASTRA_PROJECT_ID || environment.MASTRA_ENVIRONMENT_ID) &&
      !environment.SUPABASE_CA_CERT_BASE64) {
    throw new Error('SUPABASE_CA_CERT_BASE64 is required for hosted runtime PostgreSQL.');
  }
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
