import { X509Certificate } from 'node:crypto';
import type { ConnectionOptions } from 'node:tls';
import type { DatabaseEnvironment } from './supabase-config.ts';

const INVALID_CA = 'SUPABASE_CA_CERT_BASE64 must encode one valid PEM CA certificate.';
const MAX_ENCODED_CA_LENGTH = 32_768;

/**
 * Build per-pool trust for the Supabase connection only; do not alter the
 * process-wide CA store. The input is the public CA downloaded from the
 * matching project's Supabase SSL configuration, encoded as one base64 line.
 *
 * Explicit `ssl` takes precedence over `sslmode` in @mastra/pg@1.35.0's
 * buildConnectionStringPoolConfig. This keeps hostname/certificate checking
 * enabled and does not affect HTTPS, Mastra Cloud, or Turso connections.
 */
export function resolveSupabaseTlsOptions(
  canonicalConnectionString: string,
  environment: Pick<DatabaseEnvironment, 'SUPABASE_CA_CERT_BASE64'> = process.env,
): ConnectionOptions | undefined {
  const encoded = environment.SUPABASE_CA_CERT_BASE64;
  if (encoded === undefined || encoded === '') {
    // Preserve existing local NODE_EXTRA_CA_CERTS / normal Node.js trust path.
    return undefined;
  }

  // Reject empty, noncanonical and oversized data without ever reflecting it.
  if (
    encoded.length > MAX_ENCODED_CA_LENGTH ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)
  ) {
    throw new Error(INVALID_CA);
  }

  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.toString('base64') !== encoded) {
    throw new Error(INVALID_CA);
  }

  const pem = bytes.toString('utf8').replace(/\r\n/g, '\n').trim();
  if (
    !/^-----BEGIN CERTIFICATE-----\n(?:[A-Za-z0-9+/=]+\n)+-----END CERTIFICATE-----$/.test(pem)
  ) {
    throw new Error(INVALID_CA);
  }

  try {
    const certificate = new X509Certificate(pem);
    if (!certificate.ca) {
      throw new Error(INVALID_CA);
    }
  } catch {
    throw new Error(INVALID_CA);
  }

  // The validated URL comes from requirePostgresConnectionString(), which
  // rejects other projects, override parameters, insecure modes, and ports.
  const servername = new URL(canonicalConnectionString).hostname;
  return {
    ca: pem,
    rejectUnauthorized: true,
    servername,
  };
}
