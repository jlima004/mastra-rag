export interface Transaction {
  query<Row = Record<string, unknown>>(
    sql: string, values?: unknown[],
  ): Promise<{ rows: Row[]; rowCount: number | null }>;
}

export interface Pool extends Transaction {
  connect(): Promise<Transaction & { release(destroy?: boolean): void }>;
  end(): Promise<void>;
}

export async function withTransaction<T>(pool: Pool, work: (tx: Transaction) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  let discard = false;
  try {
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    await client.query("SET LOCAL statement_timeout = '15s'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout = '15s'");
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      discard = true;
    }
    throw error;
  } finally {
    client.release(discard);
  }
}

export async function lockDocument(tx: Transaction, documentId: string): Promise<void> {
  await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('rag:doc:' || $1, 0))", [documentId]);
}

export async function lockSource(tx: Transaction, sourceId: string): Promise<void> {
  await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('rag:source:' || $1, 0))", [sourceId]);
}
