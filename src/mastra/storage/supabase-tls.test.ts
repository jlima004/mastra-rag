import assert from 'node:assert/strict';
import test from 'node:test';
import { rootCertificates } from 'node:tls';
import { X509Certificate } from 'node:crypto';
import { resolveSupabaseTlsOptions } from './supabase-tls.ts';
import { requirePostgresConnectionString, SUPABASE_PROJECT_REF } from './supabase-config.ts';

const session = `postgresql://postgres.${SUPABASE_PROJECT_REF}:not-secret@aws-0-sa-east-1.pooler.supabase.com:5432/postgres?sslmode=verify-full`;
const direct = `postgresql://postgres:not-secret@db.${SUPABASE_PROJECT_REF}.supabase.co:5432/postgres?sslmode=require`;

// A public, bundled Mozilla CA root is sufficient for configuration tests.
// No private keys, live Supabase access, or test secrets are required.
const ca = rootCertificates.find(value => new X509Certificate(value).ca);
if (!ca) throw new Error('No public CA root available in the Node.js test runtime');
const encoded = Buffer.from(ca).toString('base64');

test('without configured CA, existing NODE_EXTRA_CA_CERTS behavior is unchanged', () => {
  assert.equal(resolveSupabaseTlsOptions(session, {}), undefined);
  assert.equal(resolveSupabaseTlsOptions(session, { SUPABASE_CA_CERT_BASE64: '' }), undefined);
});

test('configures CA trust per pool with strict verification and validated session hostname', () => {
  const dsn = requirePostgresConnectionString({ POSTGRES_CONNECTION_STRING: session });
  const ssl = resolveSupabaseTlsOptions(dsn, { SUPABASE_CA_CERT_BASE64: encoded });
  assert.ok(ssl);
  assert.equal(ssl.rejectUnauthorized, true);
  assert.equal(ssl.servername, 'aws-0-sa-east-1.pooler.supabase.com');
  assert.equal(ssl.ca, ca.trim());
  assert.equal('checkServerIdentity' in ssl, false);
});

test('also enforces hostname verification for direct connection', () => {
  const dsn = requirePostgresConnectionString({ POSTGRES_CONNECTION_STRING: direct });
  const ssl = resolveSupabaseTlsOptions(dsn, { SUPABASE_CA_CERT_BASE64: encoded });
  assert.equal(ssl?.servername, `db.${SUPABASE_PROJECT_REF}.supabase.co`);
  assert.equal(ssl?.rejectUnauthorized, true);
});

test('rejects malformed, noncanonical and unexpected certificate payloads without reflecting them', () => {
  const candidates = [
    'not-base64-%SECRET%',
    '%%%PRIVATE%%%',
    Buffer.from('not a certificate').toString('base64'),
    'A'.repeat(32772),
    'SGVsbG8=',
    encoded + ' ',
    Buffer.from('-----BEGIN CERTIFICATE-----\ninvalid\n-----END CERTIFICATE-----').toString('base64'),
  ];
  for (const value of candidates) {
    assert.throws(
      () => resolveSupabaseTlsOptions(session, { SUPABASE_CA_CERT_BASE64: value }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, 'SUPABASE_CA_CERT_BASE64 must encode one valid PEM CA certificate.');
        assert.doesNotMatch(error.message, /PRIVATE|SECRET|not-base64|SGVsbG8/);
        return true;
      },
    );
  }
});

test('does not accept two certificates as one trusted root', () => {
  const doubled = Buffer.from(ca + '\n' + ca).toString('base64');
  assert.throws(() => resolveSupabaseTlsOptions(session, { SUPABASE_CA_CERT_BASE64: doubled }));
});
