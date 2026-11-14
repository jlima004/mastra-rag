import assert from 'node:assert/strict';
import test from 'node:test';
import {
  diagnoseSupabaseReadiness,
  supabaseReadinessRoute,
  type ReadinessDependencies,
} from './supabase-readiness.ts';

type FailureOptions = {
  createError?: Error;
  verifyError?: Error;
  disconnectError?: Error;
  onDisconnect?: () => void;
};

function dependencies(options: FailureOptions = {}): ReadinessDependencies {
  return {
    createStore: () => {
      if (options.createError) throw options.createError;
      return {
        pool: { query: async () => ({ rows: [] }) },
        disconnect: async () => {
          options.onDisconnect?.();
          if (options.disconnectError) throw options.disconnectError;
        },
      };
    },
    verify: async () => {
      if (options.verifyError) throw options.verifyError;
    },
  };
}

test('authenticated route exists', () => {
  assert.ok(supabaseReadinessRoute);
});

test('success returns only status and disconnects once', async () => {
  let disconnects = 0;
  const status = await diagnoseSupabaseReadiness(
    dependencies({ onDisconnect: () => { disconnects += 1; } }),
  );
  assert.deepEqual(status, { status: 'ok' });
  assert.equal(disconnects, 1);
});

test('missing server-side DSN has only a sanitized CONFIGURATION category', async () => {
  const status = await diagnoseSupabaseReadiness(
    dependencies({ createError: new Error('POSTGRES_CONNECTION_STRING must be set on server') }),
  );
  assert.deepEqual(status, { status: 'unavailable', category: 'CONFIGURATION' });
});

test('nested TLS certificate errors are classified and secrets never leak', async () => {
  const sensitive = 'SECRET_PASSWORD_MUST_NOT_APPEAR';
  const cause = Object.assign(new Error('certificate failure ' + sensitive), {
    code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  });
  let disconnects = 0;
  const status = await diagnoseSupabaseReadiness(
    dependencies({
      verifyError: new Error('database driver error ' + sensitive, { cause }),
      onDisconnect: () => { disconnects += 1; },
    }),
  );
  assert.deepEqual(status, { status: 'unavailable', category: 'TLS_CERTIFICATE' });
  assert.equal(disconnects, 1);
  assert.doesNotMatch(JSON.stringify(status), /SECRET_PASSWORD|certificate failure/);
});

test('authentication and network errors return fixed categories', async () => {
  const authError = Object.assign(new Error('password value hidden'), { code: '28P01' });
  const networkError = Object.assign(new Error('endpoint value hidden'), { code: 'ENOTFOUND' });
  assert.deepEqual(
    await diagnoseSupabaseReadiness(dependencies({ verifyError: authError })),
    { status: 'unavailable', category: 'AUTHENTICATION' },
  );
  assert.deepEqual(
    await diagnoseSupabaseReadiness(dependencies({ verifyError: networkError })),
    { status: 'unavailable', category: 'NETWORK' },
  );
});

test('unclassified driver errors do not reveal credentials', async () => {
  const status = await diagnoseSupabaseReadiness(
    dependencies({ verifyError: new Error('postgresql://user:SECRET@host.invalid:5432/postgres') }),
  );
  assert.deepEqual(status, { status: 'unavailable', category: 'UNCLASSIFIED' });
  assert.doesNotMatch(JSON.stringify(status), /SECRET|host.invalid|postgresql/);
});

test('failed disconnect blocks readiness without masking original failure', async () => {
  const disconnectError = new Error('secret disconnect detail');
  assert.deepEqual(
    await diagnoseSupabaseReadiness(dependencies({ disconnectError })),
    { status: 'unavailable', category: 'UNCLASSIFIED' },
  );
  const authError = Object.assign(new Error('masked auth detail'), { code: '28P01' });
  assert.deepEqual(
    await diagnoseSupabaseReadiness(dependencies({ verifyError: authError, disconnectError })),
    { status: 'unavailable', category: 'AUTHENTICATION' },
  );
});
