import { PgVector } from '@mastra/pg';
import type { Pool, Transaction } from '../src/mastra/rag/ingestion/database.ts';

export const E2_LOCAL_MARKER = 'E2_DISPOSABLE_LOCAL_POSTGRES17';
const USER = { app: 'rag_app', owner: 'postgres' } as const;

/** This harness takes no external DSN and verifies the isolated fixture's identity. */
export async function openE2LocalPool(role: keyof typeof USER = 'app'): Promise<Pool> {
  const user = USER[role];
  const vector = new PgVector({
    id: 'e2-local-disposable-only',
    connectionString: `postgresql://${user}:e1-local-ci-only@127.0.0.1:54329/rag_e1?sslmode=disable`,
    schemaName: 'rag',
    disableInit: true,
    max: 4,
    pgPoolOptions: { connectionTimeoutMillis: 2000 },
  });
  const pool = vector.pool;
  try {
    const db: Transaction = pool;
    const proof = await db.query<{ valid: boolean }>(`
      SELECT marker=$1 AND current_database()='rag_e1' AND current_user=$2
        AND current_setting('server_version_num')::int / 10000 = 17 AS valid
      FROM rag.e2_disposable_test_marker
    `, [E2_LOCAL_MARKER, user]);
    if (proof.rows.length !== 1 || proof.rows[0].valid !== true) throw new Error();
    return pool;
  } catch {
    await pool.end();
    throw new Error('E2_LOCAL_DATABASE_REQUIRED');
  }
}
