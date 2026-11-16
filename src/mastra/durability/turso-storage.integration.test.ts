import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { LibSQLStore } from '@mastra/libsql';
import {
  createDurabilityProbe, readDurabilityProbe, deleteDurabilityProbe,
} from './turso-probe.ts';

test('native libSQL memory storage persists a thread across separate store instances', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mastra-turso-durability-'));
  try {
    const url = 'file:' + join(dir, 'durability.db');
    const first = new LibSQLStore({ id: 'turso-assay-first', url });
    const initialMemory = await first.getStore('memory');
    assert.ok(initialMemory);
    await initialMemory.init();
    const created = await createDurabilityProbe(initialMemory);

    // Simulates a newly initialized application instance using the same DB.
    const second = new LibSQLStore({ id: 'turso-assay-second', url });
    const newMemory = await second.getStore('memory');
    assert.ok(newMemory);
    await newMemory.init();
    assert.deepEqual(await readDurabilityProbe(newMemory, created.probeId), created);
    assert.equal(await deleteDurabilityProbe(newMemory, created.probeId), true);
    assert.equal(await readDurabilityProbe(initialMemory, created.probeId), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
