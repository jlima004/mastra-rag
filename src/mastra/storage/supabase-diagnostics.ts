/** Sanitized diagnostics for operator-only checks.
 * Never print driver messages, connection strings or error objects: they may
 * contain the DB hostname, username, password or session parameters.
 */
export type DatabaseCheckDiagnostic = Readonly<{
  category: string;
  suggestion: string;
}>;

type DriverFailure = {
  code?: unknown;
  message?: unknown;
  cause?: unknown;
};

export function describeDatabaseCheckFailure(error: unknown): DatabaseCheckDiagnostic {
  const codes: string[] = [];
  const messages: string[] = [];
  let node: unknown = error;

  // Inspect a bounded cause chain, without outputting untrusted fields.
  for (let depth = 0; depth < 4; depth++) {
    if (node === null || typeof node !== 'object') break;
    const failure = node as DriverFailure;

    if (typeof failure.code === 'string') codes.push(failure.code);
    if (typeof failure.message === 'string') messages.push(failure.message);
    node = failure.cause;
  }

  const combinedMessage = messages.join(' ');
  const hasCode = (...values: string[]): boolean => codes.some(code => values.includes(code));

  if (
    /POSTGRES_CONNECTION_STRING|SUPABASE_CA_CERT_BASE64|Invalid PostgreSQL connection parameters|Use the PostgreSQL database|Require PostgreSQL TLS/.test(combinedMessage)
  ) {
    return {
      category: 'CONFIGURATION',
      suggestion: 'Check the server-only PostgreSQL URL, its project, port and TLS parameters.',
    };
  }

  if (
    hasCode('28P01', '28000') ||
    /password authentication failed|Tenant or user not found|authentication failed|SCRAM/i.test(combinedMessage)
  ) {
    return {
      category: 'AUTHENTICATION',
      suggestion: 'Confirm the Session Pooler username, URL-encoded database password and project-specific host in Supabase Connect.',
    };
  }

  if (
    hasCode(
      'ERR_TLS_CERT_ALTNAME_INVALID',
      'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
      'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
      'SELF_SIGNED_CERT_IN_CHAIN',
      'CERT_HAS_EXPIRED',
      'ERR_SSL_TLSV1_ALERT_UNKNOWN_CA',
    ) ||
    /certificate verify failed|self.signed certificate|certificate has expired|unable to verify.*certificate|hostname.*certificate/i.test(combinedMessage)
  ) {
    return {
      category: 'TLS_CERTIFICATE',
      suggestion: 'Verify the Supabase endpoint hostname and trusted CA certificate. Do not disable TLS verification.',
    };
  }

  if (
    hasCode('ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'ETIMEDOUT', 'ECONNRESET') ||
    /connection timed out|connect ETIMEDOUT|Connection terminated unexpectedly|timeout exceeded/i.test(combinedMessage)
  ) {
    return {
      category: 'NETWORK',
      suggestion: 'Verify DNS and outbound network connectivity to the Session Pooler on TCP port 5432.',
    };
  }

  if (
    /Supabase pgvector extension or private rag schema is unavailable|The rag schema grants access to a public API role|Supabase runtime role, vector schema or RLS contract is unavailable/.test(combinedMessage)
  ) {
    return {
      category: 'FOUNDATION',
      suggestion: 'Inspect the vector extension, rag schema and schema privileges in Supabase.',
    };
  }

  if (hasCode('42501', '3D000')) {
    return {
      category: 'DATABASE_PERMISSION_OR_NAME',
      suggestion: 'Verify database selection and the PostgreSQL role permissions.',
    };
  }

  return {
    category: 'UNCLASSIFIED',
    suggestion: 'Could not safely classify this failure. Test the same connection locally with psql; do not share the DSN or raw error logs.',
  };
}
