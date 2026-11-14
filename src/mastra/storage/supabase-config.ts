/** Public project metadata, not a credential. */
export const SUPABASE_PROJECT_REF = 'lmocjhpajhxegzobydau';
export const RAG_SCHEMA_NAME = 'rag';

export type DatabaseEnvironment = Readonly<{
  POSTGRES_CONNECTION_STRING?: string;
  /** Optional private server-side base64-encoded Supabase root CA PEM. */
  SUPABASE_CA_CERT_BASE64?: string;
}>;

/**
 * Fail closed before constructing a database client.
 * Do not include the received URL in errors: it contains credentials.
 */
export function requirePostgresConnectionString(
  environment: DatabaseEnvironment = process.env,
): string {
  const connectionString = environment.POSTGRES_CONNECTION_STRING?.trim();

  if (!connectionString) {
    throw new Error('POSTGRES_CONNECTION_STRING must be set on the server.');
  }

  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error('POSTGRES_CONNECTION_STRING must be a valid PostgreSQL URL.');
  }

  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !url.hostname ||
    !url.username ||
    !url.password ||
    url.hash
  ) {
    throw new Error('POSTGRES_CONNECTION_STRING has an invalid PostgreSQL URL structure.');
  }

  const directHost = `db.${SUPABASE_PROJECT_REF}.supabase.co`;
  const isDirect = url.hostname === directHost;
  const isSessionPooler =
    url.hostname.endsWith('.pooler.supabase.com') &&
    decodeURIComponent(url.username).endsWith(`.${SUPABASE_PROJECT_REF}`);

  if (!isDirect && !isSessionPooler) {
    throw new Error('POSTGRES_CONNECTION_STRING must target the configured Supabase project.');
  }

  // The RAG foundation intentionally uses a session-capable connection.
  if (url.port !== '5432' || url.pathname !== '/postgres') {
    throw new Error('Use the PostgreSQL database on port 5432 (direct or session pooler).');
  }

  // PgVector forwards this DSN to pg-connection-string. The driver applies the
  // last duplicate parameter and allows query parameters to override host,
  // port, user and TLS settings. Fail closed rather than trusting the first
  // URLSearchParams value or silently forwarding unchecked options.
  const parameters = [...url.searchParams.entries()];
  if (
    parameters.length !== 1 ||
    parameters[0]?.[0] !== 'sslmode' ||
    !['require', 'verify-full'].includes(parameters[0][1])
  ) {
    throw new Error('Invalid PostgreSQL connection parameters: a single TLS sslmode is required.');
  }

  // Pass a canonical URL to pg-connection-string. Validating decoded URLSearchParams
  // but forwarding the raw query can cause driver parse differences when the
  // original DSN contains whitespace and percent-encoded parameter names.
  const sslmode = parameters[0][1];
  url.search = '';
  url.searchParams.set('sslmode', sslmode);
  return url.toString();
}
