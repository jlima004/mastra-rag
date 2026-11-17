/**
 * Fail-closed DSN guard for the E1 disposable PostgreSQL 17 provisioner.
 *
 * pg-connection-string applies query parameters before URL authority fields
 * and accepts duplicate parameters (last value wins). Validate the complete
 * query and forward ONLY this canonicalized DSN, never the untrusted input.
 *
 * Pure validation: no PgVector import, connections, filesystem or logs.
 */
const E1_LOCAL_ONLY = 'E1_LOCAL_ONLY';

export function requireE1LocalDatabaseUrl(input: unknown): string {
  if (typeof input !== 'string' || !input) {
    throw new Error(E1_LOCAL_ONLY);
  }

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error(E1_LOCAL_ONLY);
  }

  const parameters = [...url.searchParams.entries()];
  if (
    url.protocol !== 'postgresql:' ||
    url.hostname !== '127.0.0.1' ||
    url.port !== '54329' ||
    url.pathname !== '/rag_e1' ||
    url.username !== 'postgres' ||
    !url.password ||
    url.hash !== '' ||
    parameters.length !== 1 ||
    parameters[0]?.[0] !== 'sslmode' ||
    parameters[0]?.[1] !== 'disable'
  ) {
    throw new Error(E1_LOCAL_ONLY);
  }

  // Remove the original query before handing the URL to pg-connection-string.
  // Driver-level host/port/user/TLS overrides must never reach PgVector.
  url.search = '';
  url.searchParams.set('sslmode', 'disable');
  return url.toString();
}
