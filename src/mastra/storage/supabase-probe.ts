/** Read-only inspection; does not create tables, extensions, indexes or rows. */
export const FOUNDATION_PROBE_SQL = `
SELECT
  EXISTS (
    SELECT 1 FROM pg_extension e
    JOIN pg_namespace n ON n.oid = e.extnamespace
    WHERE e.extname = 'vector' AND n.nspname = 'extensions'
  ) AS vector_enabled,
  EXISTS (
    SELECT 1 FROM pg_namespace WHERE nspname = 'rag'
  ) AS rag_schema_exists,
  has_schema_privilege('anon', 'rag', 'USAGE') AS anon_has_schema_usage,
  has_schema_privilege('authenticated', 'rag', 'USAGE') AS authenticated_has_schema_usage
`;

type FoundationRow = {
  vector_enabled: boolean;
  rag_schema_exists: boolean;
  anon_has_schema_usage: boolean;
  authenticated_has_schema_usage: boolean;
};

type QueryRunner = {
  query(sql: string): Promise<{ rows: FoundationRow[] }>;
};

export async function verifySupabaseFoundation(database: QueryRunner): Promise<void> {
  const result = await database.query(FOUNDATION_PROBE_SQL);
  const status = result.rows[0];

  if (result.rows.length !== 1 || !status?.vector_enabled || !status?.rag_schema_exists) {
    throw new Error('Supabase pgvector extension or private rag schema is unavailable.');
  }

  if (status.anon_has_schema_usage || status.authenticated_has_schema_usage) {
    throw new Error('The rag schema grants access to a public API role.');
  }
}
