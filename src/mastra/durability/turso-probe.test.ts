import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DURABILITY_PROBE_RESOURCE,
  DurabilityProbeCreationError,
  createDurabilityProbe,
  deleteDurabilityProbe,
  isProbeEnabled,
  isProbeId,
  readDurabilityProbe,
  type ProbeMemoryStore,
  type ProbeThread,
} from './turso-probe.ts';

function fakeStore(): ProbeMemoryStore {
  const records = new Map<string, ProbeThread>();
  return {
    async saveThread({ thread }) {
      records.set(thread.id, structuredClone(thread));
      return thread;
    },
    async getThreadById({ threadId, resourceId }) {
      const thread = records.get(threadId);
      return thread && (!resourceId || thread.resourceId === resourceId)
        ? structuredClone(thread)
        : null;
    },
    async deleteThread({ threadId }) {
      records.delete(threadId);
    },
  };
}

test('probe is disabled by default and requires a remote Turso URL', () => {
  assert.equal(isProbeEnabled({}), false);
  assert.equal(isProbeEnabled({ TURSO_DURABILITY_PROBE_ENABLED: 'true' }), false);
  assert.equal(isProbeEnabled({ TURSO_DURABILITY_PROBE_ENABLED: 'true', TURSO_DATABASE_URL: 'file:/tmp/mastra.db' }), false);
  assert.equal(isProbeEnabled({ TURSO_DURABILITY_PROBE_ENABLED: 'TRUE', TURSO_DATABASE_URL: 'libsql://test.example' }), false);
  assert.equal(isProbeEnabled({ TURSO_DURABILITY_PROBE_ENABLED: 'true', TURSO_DATABASE_URL: 'libsql://test.example' }), true);
});

test('creates unique reserved records, reads them and cleans only exact target', async () => {
  const memory = fakeStore();
  const first = await createDurabilityProbe(memory);
  const second = await createDurabilityProbe(memory);
  assert.notEqual(first.probeId, second.probeId);
  assert.notEqual(first.fingerprint, second.fingerprint);
  assert.equal(isProbeId(first.probeId), true);
  assert.match(first.fingerprint, /^[0-9a-f]{64}$/);
  assert.deepEqual(await readDurabilityProbe(memory, first.probeId), first);
  assert.equal(await deleteDurabilityProbe(memory, first.probeId), true);
  assert.equal(await readDurabilityProbe(memory, first.probeId), null);
  assert.deepEqual(await readDurabilityProbe(memory, second.probeId), second);
  assert.equal(await deleteDurabilityProbe(memory, first.probeId), false);
});

test('malformed and other-resource thread IDs are never read or deleted', async () => {
  const memory = fakeStore();
  const created = await createDurabilityProbe(memory);
  for (const id of ['anything', '../mastra', '', 'mastra-rag-durability-00000000-0000-0000-0000-000000000000']) {
    assert.equal(isProbeId(id), false);
    assert.equal(await readDurabilityProbe(memory, id), null);
    assert.equal(await deleteDurabilityProbe(memory, id), false);
  }
  assert.deepEqual(await readDurabilityProbe(memory, created.probeId), created);
});

test('does not disclose marker or underlying storage metadata', async () => {
  const memory = fakeStore();
  const created = await createDurabilityProbe(memory);
  assert.deepEqual(Object.keys(created).sort(), ['createdAt', 'fingerprint', 'probeId']);
  assert.equal(JSON.stringify(created).includes('marker'), false);
  assert.deepEqual(await readDurabilityProbe(memory, created.probeId), created);
});

test('failed read-after-write attempts cleanup and confirms absence', async () => {
  const memory = fakeStore();
  const getThreadById = memory.getThreadById;
  let firstRead = true;
  memory.getThreadById = async args => {
    if (firstRead) {
      firstRead = false;
      throw new Error('secret database read failed');
    }
    return getThreadById(args);
  };
  await assert.rejects(
    () => createDurabilityProbe(memory),
    (error: unknown) => {
      assert.ok(error instanceof DurabilityProbeCreationError);
      assert.equal(error.cleanupConfirmed, true);
      assert.equal(isProbeId(error.probeId), true);
      assert.doesNotMatch(error.message, /secret database/);
      return true;
    },
  );
});

test('unconfirmed cleanup reports a recovery ID without leaking driver errors', async () => {
  const memory = fakeStore();
  memory.getThreadById = async () => { throw new Error('secret read failed'); };
  memory.deleteThread = async () => { throw new Error('secret delete failed'); };
  await assert.rejects(
    () => createDurabilityProbe(memory),
    (error: unknown) => {
      assert.ok(error instanceof DurabilityProbeCreationError);
      assert.equal(error.cleanupConfirmed, false);
      assert.equal(isProbeId(error.probeId), true);
      assert.doesNotMatch(error.message, /secret read|secret delete/);
      return true;
    },
  );
});

test('cleanup accepts incomplete marker metadata only inside the reserved resource', async () => {
  const memory = fakeStore();
  const created = await createDurabilityProbe(memory);
  const original = memory.getThreadById;
  memory.getThreadById = async args => {
    const thread = await original(args);
    if (thread && args.threadId === created.probeId) return { ...thread, metadata: {} };
    return thread;
  };
  assert.equal(await deleteDurabilityProbe(memory, created.probeId), true);
});
